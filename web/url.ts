/**
 * What the page shows, as the part of the address after `#`, so any view can be linked to.
 *
 *   q=where                      question            f=/^c\d+$/&pool=1     filter, pool the matches
 *   runs=/2026-11-11/            runs whose name matches (text or /regex/, like the question filter)
 *   run=a&run=b                  exactly these runs  norun=a&norun=b       every run but these
 *   view=compare                 overview (default) or compare
 *   by=tag:variant&a=v0&b=v1     compare by a feature, A and B
 *   t=0.6                        threshold           split=tag:lang        split the overview charts
 *   tab=worse                    table tab           open=<record id>      open one call
 *
 * Everything is optional; values the data does not have fall back to the defaults.
 */

export type ViewMode = 'overview' | 'compare';

export interface ViewState {
  q: string;
  f: string;
  pool: boolean;
  /** Run filter: text or /regex/. */
  runs?: string;
  /** Runs named one by one: either the ones to show or the ones to hide. */
  run: string[];
  norun: string[];
  view: ViewMode;
  by?: string;
  a?: string;
  b?: string;
  t?: number;
  split?: string;
  tab?: string;
  open?: string;
}

export const emptyView = (): ViewState => ({ q: '', f: '', pool: false, run: [], norun: [], view: 'overview' });

/** Text filter: plain text matches as a case-insensitive substring; /…/ is a regular expression. Invalid regex matches nothing. */
export function matcher(filter: string): (s: string) => boolean {
  const f = filter.trim();
  if (!f) return () => true;
  if (f.length > 2 && f.startsWith('/') && f.endsWith('/')) {
    try {
      const re = new RegExp(f.slice(1, -1));
      return (s: string) => re.test(s);
    } catch {
      return () => false;
    }
  }
  return (s: string) => s.toLowerCase().includes(f.toLowerCase());
}

export function parseView(hash: string): ViewState {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const text = (k: string) => p.get(k) ?? undefined;
  const t = Number(p.get('t'));
  return {
    q: p.get('q') ?? '',
    f: p.get('f') ?? '',
    pool: p.get('pool') === '1',
    runs: text('runs'),
    run: p.getAll('run'),
    norun: p.getAll('norun'),
    view: p.get('view') === 'compare' ? 'compare' : 'overview',
    by: text('by'),
    a: text('a'),
    b: text('b'),
    t: p.has('t') && Number.isFinite(t) && t >= 0 && t <= 1 ? t : undefined,
    split: text('split'),
    tab: text('tab'),
    open: text('open'),
  };
}

/** The inverse of parseView; leaves out defaults so links stay short. */
export function formatView(s: ViewState): string {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.f) p.set('f', s.f);
  if (s.pool) p.set('pool', '1');
  if (s.runs) p.set('runs', s.runs);
  for (const r of s.run) p.append('run', r);
  for (const r of s.norun) p.append('norun', r);
  if (s.view !== 'overview') p.set('view', s.view);
  for (const k of ['by', 'a', 'b', 'split', 'tab', 'open'] as const) if (s[k] !== undefined && s[k] !== '') p.set(k, s[k]!);
  if (s.t !== undefined) p.set('t', String(Math.round(s.t * 1000) / 1000));
  // Keep / and : readable; URLSearchParams escapes more than a hash needs.
  return p.toString().replace(/%2F/gi, '/').replace(/%3A/gi, ':');
}

/** The runs a link selects, and what in it did not match. Without any run parameter: every run. */
export function selectRuns(s: Pick<ViewState, 'runs' | 'run' | 'norun'>, names: string[]) {
  const missing: string[] = [];
  let picked = new Set(names);
  if (s.runs !== undefined) {
    const m = matcher(s.runs);
    picked = new Set(names.filter(m));
    if (!picked.size) missing.push(`run filter ${s.runs} matched no run`);
  }
  if (s.run.length) {
    const known = new Set(names);
    const named = s.run.filter((r) => known.has(r));
    if (named.length < s.run.length) missing.push(`${s.run.length - named.length} of ${s.run.length} named runs not loaded`);
    picked = s.runs !== undefined ? new Set([...picked, ...named]) : new Set(named);
  }
  for (const r of s.norun) picked.delete(r);
  return { runs: picked, missing };
}

/**
 * The shortest run parameters that give `selected`: nothing for all runs, the link's filter if it still
 * gives exactly this set, otherwise the shorter of the names shown and the names hidden.
 */
export function describeRuns(selected: Set<string>, names: string[], filter?: string): Pick<ViewState, 'runs' | 'run' | 'norun'> {
  if (selected.size === names.length) return { run: [], norun: [] };
  if (filter !== undefined) {
    const m = matcher(filter);
    const byFilter = names.filter(m);
    if (byFilter.length === selected.size && byFilter.every((r) => selected.has(r))) return { runs: filter, run: [], norun: [] };
  }
  const shown = names.filter((r) => selected.has(r));
  const hidden = names.filter((r) => !selected.has(r));
  return shown.length <= hidden.length ? { run: shown, norun: [] } : { run: [], norun: hidden };
}
