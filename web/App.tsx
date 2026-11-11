import { useEffect, useMemo, useState } from 'react';
import type { Overview, RowQuery, RowResult } from '../src/api.ts';
import type { DecisionRecord, Row } from '../src/format.ts';
import { brier, confusion, ece, featureOf, labeled, usualThreshold } from '../src/stats.ts';
import { CompareView, type CompareLink } from './Compare.tsx';
import { Histogram, Reliability, Sweep, useColors } from './charts.tsx';
import { describeRuns, formatView, matcher, parseView, selectRuns, type ViewState } from './url.ts';

/** The view settings below the question that the address carries (see url.ts). */
type Ui = Pick<ViewState, 'view' | 'by' | 'a' | 'b' | 't' | 'split' | 'tab' | 'open'>;
const uiOf = (v: ViewState): Ui => ({ view: v.view, by: v.by, a: v.a, b: v.b, t: v.t, split: v.split, tab: v.tab, open: v.open });

const fmt = (x: number | undefined, digits = 2) => (x === undefined ? '–' : x.toFixed(digits));
const pct = (x: number | undefined) => (x === undefined ? '–' : `${(x * 100).toFixed(1)}%`);

/**
 * Fetches the answers to the given questions in the given runs. Narrowing the runs filters the
 * answers already loaded; anything else asks the server. While a request is on its way the previous
 * answers to the same questions stay on screen; a newer request cancels an older one.
 */
function useRows(questions: string[], runs: Set<string> | undefined, runCount: number) {
  type Loaded = { key: string; questions: string; runs?: Set<string>; result?: RowResult; error?: string };
  const [state, setState] = useState<Loaded>({ key: '', questions: '' });
  // Send no run list when every run is selected: it is the common case and keeps the request small.
  const all = runs?.size === runCount;
  const query: RowQuery | undefined = runs?.size && questions.length ? { questions, ...(all ? {} : { runs: [...runs].sort() }) } : undefined;
  const key = query ? JSON.stringify(query) : '';
  const qkey = JSON.stringify(questions);
  const covered =
    !!query && !!state.result && state.questions === qkey && (!state.runs || (!all && query.runs!.every((r) => state.runs!.has(r))));
  useEffect(() => {
    if (!query || covered) return;
    const abort = new AbortController();
    const loaded = { key, questions: qkey, runs: query.runs && new Set(query.runs) };
    fetch('/api/rows', { method: 'POST', body: key, headers: { 'Content-Type': 'application/json' }, signal: abort.signal })
      .then((r) => (r.ok ? r.json() : r.json().then((e) => Promise.reject(new Error(e.error ?? `HTTP ${r.status}`)))))
      .then((result: RowResult) => setState({ ...loaded, result }))
      .catch((e: Error) => abort.signal.aborted || setState({ ...loaded, error: e.message }));
    return () => abort.abort();
  }, [key, covered]);
  const narrowed = useMemo(() => {
    if (!covered || !state.result || state.key === key) return state.result;
    const keep = new Set(query!.runs ?? []);
    return { ...state.result, rows: state.result.rows.filter((r) => all || keep.has(r.run)) };
  }, [covered, state, key]);
  if (!query) return { result: undefined, loading: false, error: undefined };
  if (covered) return { result: narrowed, loading: false, error: undefined };
  const stale = state.key !== key;
  const result = !stale || state.questions === qkey ? state.result : undefined;
  return { result, loading: stale, error: stale ? undefined : state.error };
}

export function App() {
  const [data, setData] = useState<Overview>();
  const [error, setError] = useState<string>();
  const [runs, setRuns] = useState<Set<string>>();
  const [linked] = useState(() => parseView(location.hash));
  const [filter, setFilter] = useState(linked.f);
  const [pool, setPool] = useState(linked.pool);
  const [question, setQuestion] = useState(linked.q);
  const [ui, setUiState] = useState<Ui>(() => uiOf(linked));
  const setUi = (patch: Partial<Ui>) => setUiState((u) => ({ ...u, ...patch }));
  // The run filter from the link, kept in the address while the selection still matches it.
  const [runFilter, setRunFilter] = useState(linked.runs);
  // What a link asked for that the data does not have.
  const [linkNotes, setLinkNotes] = useState<string[]>([]);

  // Applies a link to the page. Runs need the run names, so this waits for the overview.
  const applyLink = (v: ViewState, d: Overview) => {
    const picked = selectRuns(v, d.runs.map((r) => r.run));
    setRuns(picked.runs);
    setRunFilter(v.runs);
    setFilter(v.f);
    setPool(v.pool);
    setQuestion(v.q);
    setUiState(uiOf(v));
    setLinkNotes(picked.missing);
  };

  useEffect(() => {
    fetch('/api/overview')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Overview) => {
        setData(d);
        applyLink(linked, d);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // A link pasted into this tab: apply it. (The page's own updates use replaceState, which fires no hashchange.)
  useEffect(() => {
    if (!data) return;
    const onHash = () => applyLink(parseView(location.hash), data);
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, [data]);

  // Keep the address in step with the page, so it can be copied at any time.
  useEffect(() => {
    if (!data || !runs) return;
    const runPart = describeRuns(runs, data.runs.map((r) => r.run), runFilter);
    if (runFilter !== undefined && runPart.runs === undefined) setRunFilter(undefined);
    const hash = formatView({ q: question, f: filter, pool, ...runPart, ...ui });
    if (hash !== location.hash.slice(1)) history.replaceState(null, '', hash ? `#${hash}` : location.pathname);
  }, [data, runs, runFilter, question, filter, pool, ui]);

  const runList = useMemo(
    (): [string, RunInfo][] =>
      (data?.runs ?? []).map((r) => [r.run, { n: r.n, models: new Set(r.models) }] as [string, RunInfo]).sort(([a], [b]) => a.localeCompare(b)),
    [data],
  );
  const match = useMemo(() => matcher(filter), [filter]);

  // Counted from the per-run totals, so changing runs needs no request.
  const questions = useMemo(() => {
    const m = new Map<string, { n: number; labeled: number; type: Row['type'] }>();
    for (const c of data?.counts ?? []) {
      if (!runs?.has(c.run) || !match(c.question)) continue;
      const e = m.get(c.question) ?? { n: 0, labeled: 0, type: c.type };
      e.n += c.n;
      e.labeled += c.labeled;
      m.set(c.question, e);
    }
    return [...m].sort((a, b) => b[1].labeled - a[1].labeled || b[1].n - a[1].n || a[0].localeCompare(b[0]));
  }, [data, runs, match]);

  // Pooled view: every question that matches the filter, of the most common type among them.
  const pooledType = useMemo(() => {
    const count = new Map<string, number>();
    for (const [, q] of questions) count.set(q.type, (count.get(q.type) ?? 0) + q.n);
    return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] as Row['type'] | undefined;
  }, [questions]);

  const pooled = pool && !!filter.trim();
  const wanted = useMemo(
    () => (pooled ? questions.filter(([, q]) => q.type === pooledType).map(([q]) => q) : question ? [question] : []),
    [pooled, questions, pooledType, question],
  );
  const { result, loading, error: rowsError } = useRows(wanted, runs, runList.length);
  // Pooled rows keep only the common type, as before.
  const selected = useMemo(
    () => (pooled ? (result?.rows ?? []).filter((r) => r.type === pooledType) : (result?.rows ?? [])),
    [result, pooled, pooledType],
  );

  if (error) return <div className="empty">Could not load data: {error}</div>;
  if (!data || !runs) return <div className="empty">Loading…</div>;
  if (!data.answers)
    return (
      <div className="empty">
        No decision records found. Start the viewer with <code>s1scope view &lt;folder-of-jsonl&gt;</code>.
      </div>
    );

  const title = pooled ? `${wanted.length} questions matching ${filter}` : question;

  return (
    <div className="layout">
      <aside>
        <header className="brand">
          <h1>s1scope</h1>
          <span className="muted">
            {data.answers.toLocaleString()} answers{data.skippedCount ? ` · ${data.skippedCount} lines skipped` : ''}
          </span>
          <CopyLink />
        </header>
        <RunPicker runList={runList} runs={runs} setRuns={setRuns} />
        <section className="questions">
          <h2>Questions</h2>
          <input
            className="filter"
            placeholder="filter, or /regex/"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {filter.trim() && (
            <label className="check">
              <input type="checkbox" checked={pool} onChange={(e) => setPool(e.target.checked)} />
              <span>Pool all matching ({pooledType ?? '–'})</span>
            </label>
          )}
          <div className="qlist" role="listbox">
            {questions.map(([q, info]) => (
              <button
                key={q}
                role="option"
                aria-selected={!pool && q === question}
                className={!pool && q === question ? 'q selected' : 'q'}
                onClick={() => {
                  setPool(false);
                  setQuestion(q);
                  // Keep how the page looks; drop what belongs to the old question.
                  setUiState((u) => ({ view: u.view, by: u.by, split: u.split }));
                }}
              >
                <span className="grow mono" title={q}>
                  {q}
                </span>
                <span className="badge">{info.type}</span>
                <span className="muted num" title="answers · labeled">
                  {info.n}
                  {info.labeled ? ` · ${info.labeled}` : ''}
                </span>
              </button>
            ))}
            {!questions.length && <p className="muted">No question matches.</p>}
          </div>
        </section>
      </aside>
      <main>
        {linkNotes.length > 0 && (
          <p className="linknote">
            From the link: {linkNotes.join('; ')}.{' '}
            <button className="link" onClick={() => setLinkNotes([])}>
              dismiss
            </button>
          </p>
        )}
        {rowsError ? (
          <div className="empty">Could not load answers: {rowsError}</div>
        ) : selected.length ? (
          <>
            {loading && <div className="loading-bar" aria-label="Loading" />}
            <QuestionView
              key={title}
              title={title}
              rows={selected}
              pooled={pooled}
              definitions={result?.definitions ?? {}}
              ui={ui}
              setUi={setUi}
            />
          </>
        ) : loading ? (
          <div className="empty">Loading answers…</div>
        ) : (
          <div className="empty">
            {!runs.size ? 'No runs selected.' : wanted.length ? 'No answers to this question in the selected runs.' : 'Pick a question on the left.'}
          </div>
        )}
      </main>
    </div>
  );
}

/** Copies the address, which always describes the current view. */
function CopyLink() {
  const [done, setDone] = useState(false);
  const copy = () => {
    navigator.clipboard
      ?.writeText(location.href)
      .then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      })
      .catch(() => prompt('Copy this link', location.href));
    if (!navigator.clipboard) prompt('Copy this link', location.href);
  };
  return (
    <button className="link copylink" onClick={copy} title="Copy a link to exactly this view">
      {done ? 'Copied' : 'Copy link'}
    </button>
  );
}

function QuestionView({
  title,
  rows,
  pooled,
  definitions,
  ui,
  setUi,
}: {
  title: string;
  rows: Row[];
  pooled: boolean;
  definitions: Record<string, unknown>;
  ui: Ui;
  setUi: (patch: Partial<Ui>) => void;
}) {
  const type = rows[0].type;
  const usual = usualThreshold(rows);
  const [yScale, setYScale] = useState<'linear' | 'sqrt'>('linear');
  const [shown, setShown] = useState(50);
  const colors = useColors();

  const features = useMemo(() => {
    const tags = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r.tags)) tags.add(k);
    const base = ['none', 'run', 'model', 'backend', 'question', ...(rows.some((r) => r.qv) ? ['version'] : [])];
    return [...base, ...[...tags].sort().map((k) => `tag:${k}`)];
  }, [rows]);

  // Settings live in the address (url.ts); anything it has that does not fit this data falls back to the default.
  const t = ui.t ?? usual ?? 0.5;
  const setT = (v: number) => setUi({ t: v });
  const mode = ui.view;
  const setMode = (view: Ui['view']) => setUi({ view });
  const split = ui.split !== undefined && features.includes(ui.split) ? ui.split : 'none';
  const setSplit = (v: string) => setUi({ split: v === 'none' ? undefined : v });
  const TABS = ['errors', 'near', 'all'] as const;
  const tab = TABS.includes(ui.tab as (typeof TABS)[number]) ? (ui.tab as (typeof TABS)[number]) : 'errors';
  const setTab = (id: (typeof TABS)[number]) => setUi({ tab: id });
  const open = useMemo(
    () => (ui.open === undefined ? undefined : (rows.find((r) => r.id === ui.open && r.question === title) ?? rows.find((r) => r.id === ui.open))),
    [rows, ui.open, title],
  );
  const setOpen = (r: Row | undefined) => setUi({ open: r?.id });
  const unknown = [
    ui.split !== undefined && !features.includes(ui.split) && `split by ${ui.split}`,
    ui.open !== undefined && !open && `record ${ui.open}`,
  ].filter(Boolean);

  const points = labeled(rows);
  const c = confusion(points, t);
  const words =
    type === 'noul'
      ? { yes: 'expected yes', no: 'expected no', fp: 'False accept', fn: 'False reject', fpHint: 'expected no, p ≥ t', fnHint: 'expected yes, p < t' }
      : { yes: 'right', no: 'wrong', fp: 'Wrong but trusted', fn: 'Right but not trusted', fpHint: 'wrong choice, confidence ≥ t', fnHint: 'right choice, confidence < t' };

  const caseRows = useMemo(() => {
    const withP = rows.filter((r) => r.p !== undefined);
    if (tab === 'errors')
      return withP
        .filter((r) => r.y !== undefined && (r.p! >= t) !== r.y)
        .sort((a, b) => Math.abs(b.p! - t) - Math.abs(a.p! - t));
    if (tab === 'near') return withP.filter((r) => Math.abs(r.p! - t) <= 0.1).sort((a, b) => Math.abs(a.p! - t) - Math.abs(b.p! - t));
    return withP;
  }, [rows, tab, t]);

  if (type === 'score')
    return (
      <div className="view">
        <h2 className="mono">{title}</h2>
        <p className="muted">
          Score questions: {rows.length} answers. Distribution views for scores are not built yet.
        </p>
      </div>
    );

  return (
    <div className="view">
      <div className="viewhead">
        <h2 className="mono" title={title}>
          {title}
        </h2>
        <span className="muted">
          {type === 'noul' ? 'yes/no · p = P(yes)' : 'choice · p = confidence of the chosen option'} · {rows.length} answers ·{' '}
          {points.length} labeled
        </span>
      </div>

      {unknown.length > 0 && <p className="linknote">Not in this data: {unknown.join(', ')}.</p>}

      <Definition rows={rows} definitions={definitions} pooled={pooled} />

      <div className="modes" role="tablist">
        {(
          [
            ['overview', 'Overview'],
            ['compare', 'Compare'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? 'tab active' : 'tab'} onClick={() => setMode(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="controls">
        <label className="threshold">
          <span>Threshold</span>
          <input type="range" min={0} max={1} step={0.01} value={t} onChange={(e) => setT(Number(e.target.value))} />
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={t}
            onChange={(e) => setT(Math.min(1, Math.max(0, Number(e.target.value) || 0)))}
          />
          {usual !== undefined && (
            <button className="link" onClick={() => setT(usual)} disabled={t === usual}>
              app threshold {usual}
            </button>
          )}
        </label>
        {mode === 'overview' && (<>
        <label>
          <span>Split by</span>
          <select value={split} onChange={(e) => setSplit(e.target.value)}>
            {features.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label title="A square-root scale makes small bars visible next to large ones">
          <span>Bar height</span>
          <select value={yScale} onChange={(e) => setYScale(e.target.value as 'linear' | 'sqrt')}>
            <option value="linear">linear</option>
            <option value="sqrt">square root</option>
          </select>
        </label>
        </>)}
      </div>

      {mode === 'compare' ? (
        <CompareView
          rows={rows}
          t={t}
          pooled={pooled}
          features={features}
          type={type}
          colors={colors}
          onOpen={setOpen}
          link={{ by: ui.by, a: ui.a, b: ui.b, tab: ui.tab }}
          setLink={(patch: Partial<CompareLink>) => setUi(patch)}
        />
      ) : (<>

      {points.length > 0 ? (
        <div className="tiles">
          <Tile label={words.fp} value={String(c.fp)} hint={words.fpHint} tone="no" />
          <Tile label={words.fn} value={String(c.fn)} hint={words.fnHint} tone="yes" />
          {type === 'noul' ? (
            <>
              <Tile label="Precision" value={pct(c.precision)} hint="of p ≥ t, share expected yes" />
              <Tile label="Recall" value={pct(c.recall)} hint="of expected yes, share with p ≥ t" />
            </>
          ) : (
            <>
              <Tile label="Trusted" value={pct(c.coverage)} hint="share with confidence ≥ t" />
              <Tile label="Accuracy when trusted" value={pct(c.precision)} />
            </>
          )}
          <Tile label="Brier" value={fmt(brier(points), 3)} hint="mean (p − y)², lower is better" />
          <Tile label="ECE" value={fmt(ece(points), 3)} hint="10-bin expected calibration error" />
        </div>
      ) : (
        <p className="muted note">No labels for this question: showing the distribution only. Add label lines to see errors and calibration.</p>
      )}

      <figure>
        <figcaption>
          Distribution of p{split !== 'none' ? `, by ${split}` : ''}
        </figcaption>
        <Histogram rows={rows} t={t} split={split} words={words} colors={colors} yScale={yScale} />
      </figure>

      {points.length > 0 && (
        <div className="pair">
          <figure>
            <figcaption>Reliability: predicted p vs observed rate (dot size = answers)</figcaption>
            <Reliability rows={rows} split={split} colors={colors} />
          </figure>
          <figure>
            <figcaption>Threshold sweep: errors at every threshold</figcaption>
            <Sweep rows={rows} t={t} split={split} words={words} colors={colors} />
          </figure>
        </div>
      )}

      <section className="cases">
        <div className="tabs" role="tablist">
          {(
            [
              ['errors', `Errors at ${t.toFixed(2)}`],
              ['near', 'Near threshold (±0.10)'],
              ['all', 'All'],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'tab active' : 'tab'} onClick={() => {
                setTab(id);
                setShown(50);
              }}
            >
              {label}
            </button>
          ))}
          <span className="muted">
            {caseRows.length} rows{caseRows.length > shown ? `, showing ${shown}` : ''}
          </span>
        </div>
        <table>
          <thead>
            <tr>
              <th>run</th>
              <th>item</th>
              {pooled && split !== 'question' && <th>question</th>}
              {split !== 'none' && split !== 'run' && <th>{split}</th>}
              <th className="num">p</th>
              {type === 'choice' && <th>choice</th>}
              <th>expected</th>
            </tr>
          </thead>
          <tbody>
            {caseRows.slice(0, shown).map((r) => (
              <tr key={`${r.id}/${r.question}`} onClick={() => setOpen(r)} className={open === r ? 'open' : ''}>
                <td className="clip" title={r.run}>
                  {r.run}
                </td>
                <td className="clip mono" title={r.item}>
                  {r.item ?? r.id}
                </td>
                {pooled && split !== 'question' && <td className="mono">{r.question}</td>}
                {split !== 'none' && split !== 'run' && <td className="clip">{featureOf(r, split)}</td>}
                <td className="num">{fmt(r.p)}</td>
                {type === 'choice' && <td className="mono">{r.choice}</td>}
                <td>
                  {r.expected === undefined ? (
                    <span className="muted">–</span>
                  ) : (
                    <span className={r.y === undefined ? '' : (r.p! >= t) === r.y ? 'ok' : 'bad'}>{String(r.expected)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {caseRows.length > shown && (
          <button className="more" onClick={() => setShown(shown + 200)}>
            Show {Math.min(200, caseRows.length - shown)} more
          </button>
        )}
      </section>
      </>)}
      {open && <RecordPanel row={open} onClose={() => setOpen(undefined)} />}
    </div>
  );
}

function Tile({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'yes' | 'no' }) {
  return (
    <div className="tile" title={hint}>
      <div className="tile-label">
        {tone && <span className={`swatch ${tone}`} aria-hidden />}
        {label}
      </div>
      <div className="tile-value">{value}</div>
      {hint && <div className="tile-hint">{hint}</div>}
    </div>
  );
}

function RecordPanel({ row, onClose }: { row: Row; onClose: () => void }) {
  const [record, setRecord] = useState<DecisionRecord>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    setRecord(undefined);
    fetch(`/api/record?id=${encodeURIComponent(row.id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setRecord)
      .catch((e: Error) => setError(e.message));
  }, [row.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onClose]);

  const response = record?.response as { answers?: Record<string, unknown> } | undefined;
  const state = record?.request?.state ?? record?.request?.document;
  return (
    <div className="panel" role="dialog" aria-label="Call detail">
      <div className="panelhead">
        <h3 className="mono">{row.question}</h3>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      {error && <p className="bad">{error}</p>}
      {!record && !error && <p className="muted">Loading…</p>}
      {record && (
        <>
          <dl>
            {(
              [
                ['run', record.run],
                ['item', record.item],
                ['model', record.model_resolved ?? row.model ?? record.model],
                ['backend', record.backend],
                ['time', record.ts],
                ['latency', record.ms !== undefined ? `${record.ms} ms` : undefined],
                ['status', record.status],
                ['request id', record.request_id],
                ['expected', row.expected === undefined ? undefined : String(row.expected)],
                ['threshold', row.threshold],
                ...Object.entries(record.tags ?? {}).map(([k, v]) => [`tag ${k}`, v]),
              ] as [string, unknown][]
            )
              .filter(([, v]) => v !== undefined && v !== '')
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd className="mono">{String(v)}</dd>
                </div>
              ))}
          </dl>
          <h4>Answer</h4>
          <pre>{JSON.stringify(response?.answers?.[row.question] ?? record.answers?.[row.question], null, 2)}</pre>
          {record.request?.questions?.[row.question] !== undefined && (
            <>
              <h4>Question as sent</h4>
              <pre>{JSON.stringify(record.request.questions[row.question], null, 2)}</pre>
            </>
          )}
          {state !== undefined && (
            <>
              <h4>State</h4>
              <pre>{typeof state === 'string' ? state : JSON.stringify(state, null, 2)}</pre>
            </>
          )}
          <h4>All answers in this call</h4>
          <pre>{JSON.stringify(response?.answers ?? record.answers, null, 1)}</pre>
          {record.request !== undefined && (
            <details className="raw">
              <summary>Raw request</summary>
              <pre>{JSON.stringify(record.request, null, 2)}</pre>
            </details>
          )}
          {record.response !== undefined && (
            <details className="raw">
              <summary>Raw response</summary>
              <pre>{JSON.stringify(record.response, null, 2)}</pre>
            </details>
          )}
          {record.request === undefined && record.response === undefined && (
            <p className="muted">This record has no raw request or response, only normalized answers.</p>
          )}
          {record.error && (
            <>
              <h4>Error</h4>
              <pre className="bad">{record.error}</pre>
            </>
          )}
        </>
      )}
    </div>
  );
}

interface Version {
  qv: string;
  question: string;
  n: number;
  runs: string[];
}

/** The question as sent, once per version; rows without a request are counted separately. */
function Definition({ rows, definitions, pooled }: { rows: Row[]; definitions: Record<string, unknown>; pooled: boolean }) {
  const { versions, missing } = useMemo(() => {
    const m = new Map<string, Version>();
    let missing = 0;
    for (const r of rows) {
      if (!r.qv) {
        missing++;
        continue;
      }
      const v = m.get(r.qv) ?? { qv: r.qv, question: r.question, n: 0, runs: [] };
      v.n++;
      if (!v.runs.includes(r.run)) v.runs.push(r.run);
      m.set(r.qv, v);
    }
    // Oldest first: by the first run (alphabetical, which is time order for timestamped run names), then by size.
    const versions = [...m.values()].sort(
      (a, b) => [...a.runs].sort()[0].localeCompare([...b.runs].sort()[0]) || b.n - a.n,
    );
    return { versions, missing };
  }, [rows]);
  const [picked, setPicked] = useState(0);
  const current = versions[Math.min(picked, versions.length - 1)];

  if (!versions.length)
    return (
      <p className="muted note">
        No request was logged for these answers, so the question text is not available.
      </p>
    );

  const runsText = (v: Version) => {
    const runs = [...v.runs].sort();
    return runs.length === 1 ? runs[0] : `${runs.length} runs: ${runs[0]} … ${runs.at(-1)}`;
  };
  const label = (v: Version, i: number) => `v${i + 1} · ${v.qv}${pooled ? ` · ${v.question}` : ''} · ${v.n}`;

  return (
    <details className="definition" open={versions.length === 1 && !pooled}>
      <summary>
        <span>Question as sent</span>
        <span className="muted">
          {versions.length === 1 ? ` · 1 version` : ` · ${versions.length} versions`}
          {missing ? ` · ${missing} answers without a logged request` : ''}
        </span>
      </summary>
      {versions.length > 1 && (
        <div className="versions">
          {versions.length <= 8 ? (
            versions.map((v, i) => (
              <button
                key={v.qv}
                className={v === current ? 'chip active' : 'chip'}
                onClick={() => setPicked(i)}
                title={runsText(v)}
              >
                {label(v, i)}
              </button>
            ))
          ) : (
            <select value={picked} onChange={(e) => setPicked(Number(e.target.value))}>
              {versions.map((v, i) => (
                <option key={v.qv} value={i}>
                  {label(v, i)}
                </option>
              ))}
            </select>
          )}
          <span className="muted">Split by “version” to compare their distributions.</span>
        </div>
      )}
      <p className="muted small">
        {current.n} answers · {runsText(current)}
      </p>
      <pre>{JSON.stringify(definitions[current.qv], null, 2)}</pre>
    </details>
  );
}

type RunInfo = { n: number; models: Set<string> };

/** Runs grouped by the first word of their name ("matrix …", "playtest …"); groups with many runs start folded. */
function RunPicker({
  runList,
  runs,
  setRuns,
}: {
  runList: [string, RunInfo][];
  runs: Set<string>;
  setRuns: (s: Set<string>) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, [string, RunInfo][]>();
    for (const entry of runList) {
      const key = entry[0].split(' ')[0];
      const list = m.get(key);
      if (list) list.push(entry);
      else m.set(key, [entry]);
    }
    return [...m];
  }, [runList]);
  const [open, setOpen] = useState<Set<string>>(() => new Set(groups.filter(([, list]) => list.length <= 5).map(([g]) => g)));

  const toggle = (names: string[], on: boolean) => {
    const next = new Set(runs);
    for (const n of names) on ? next.add(n) : next.delete(n);
    setRuns(next);
  };

  return (
    <section className="runs">
      <h2>
        Runs
        <span className="muted">
          {runs.size}/{runList.length}
        </span>
        <button className="link" onClick={() => setRuns(new Set(runList.map(([r]) => r)))}>
          all
        </button>
        <button className="link" onClick={() => setRuns(new Set())}>
          none
        </button>
      </h2>
      <div className="runlist">
        {groups.map(([group, list]) => {
          const names = list.map(([r]) => r);
          const on = names.filter((r) => runs.has(r)).length;
          const total = list.reduce((s, [, i]) => s + i.n, 0);
          const isOpen = open.has(group);
          if (list.length === 1) {
            const [run, info] = list[0];
            return (
              <label key={group} className="check">
                <input type="checkbox" checked={runs.has(run)} onChange={(e) => toggle([run], e.target.checked)} />
                <span className="grow" title={run}>
                  {run}
                </span>
                <span className="muted num">{info.n.toLocaleString()}</span>
              </label>
            );
          }
          return (
            <div key={group} className="group">
              <div className="check grouphead">
                <input
                  type="checkbox"
                  checked={on === names.length}
                  ref={(el) => {
                    if (el) el.indeterminate = on > 0 && on < names.length;
                  }}
                  onChange={(e) => toggle(names, e.target.checked)}
                  aria-label={`all ${group} runs`}
                />
                <button
                  className="fold grow"
                  aria-expanded={isOpen}
                  onClick={() => {
                    const next = new Set(open);
                    isOpen ? next.delete(group) : next.add(group);
                    setOpen(next);
                  }}
                >
                  <span className="caret">{isOpen ? '▾' : '▸'}</span>
                  {group}
                  <span className="muted">
                    {' '}
                    {on === names.length ? names.length : `${on}/${names.length}`} runs
                  </span>
                </button>
                <span className="muted num">{total.toLocaleString()}</span>
              </div>
              {isOpen &&
                list.map(([run, info]) => (
                  <label key={run} className="check sub">
                    <input type="checkbox" checked={runs.has(run)} onChange={(e) => toggle([run], e.target.checked)} />
                    <span className="grow" title={run}>
                      {run.slice(group.length).trim() || run}
                    </span>
                    <span className="muted num">{info.n.toLocaleString()}</span>
                  </label>
                ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
