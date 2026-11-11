import { useMemo, useState } from 'react';
import { compare, type Pair } from '../src/compare.ts';
import type { Row } from '../src/format.ts';
import { featureOf } from '../src/stats.ts';
import { PairScatter, type Colors } from './charts.tsx';

const fmt = (x: number | undefined) => (x === undefined ? '–' : x.toFixed(2));

const TABS = ['worse', 'better', 'moved', 'all'] as const;
type Tab = (typeof TABS)[number];
export interface CompareLink {
  by?: string;
  a?: string;
  b?: string;
  tab?: string;
}

/** Two slices of the same question(s), lined up sample by sample. */
export function CompareView({
  rows,
  t,
  pooled,
  features,
  type,
  colors,
  onOpen,
  link,
  setLink,
}: {
  rows: Row[];
  t: number;
  pooled: boolean;
  features: string[];
  type: Row['type'];
  colors: Colors;
  onOpen: (r: Row) => void;
  /** Compare-by feature, A, B and table tab as the address has them (see url.ts); undefined = default. */
  link: CompareLink;
  setLink: (patch: Partial<CompareLink>) => void;
}) {
  const choices = features.filter((f) => f !== 'none' && (pooled || f !== 'question'));
  const feature = link.by !== undefined && choices.includes(link.by) ? link.by : choices.includes('run') ? 'run' : choices[0];
  const values = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(featureOf(r, feature), (counts.get(featureOf(r, feature)) ?? 0) + 1);
    return [...counts.keys()].sort();
  }, [rows, feature]);
  // Default pair: the latest value (in name order, so the newest timestamped run) that shares samples with another,
  // against the value it shares the most samples with.
  const defaults = useMemo(() => {
    const valuesOf = new Map<string, Set<string>>();
    const keysOf = new Map<string, Set<string>>();
    for (const r of rows) {
      if (r.item === undefined || r.p === undefined) continue;
      const v = featureOf(r, feature);
      const key = `${r.item}\u0000${r.question}`;
      if (!valuesOf.has(key)) valuesOf.set(key, new Set());
      valuesOf.get(key)!.add(v);
      if (!keysOf.has(v)) keysOf.set(v, new Set());
      keysOf.get(v)!.add(key);
    }
    for (let i = values.length - 1; i >= 0; i--) {
      const b = values[i];
      const overlap = new Map<string, number>();
      for (const key of keysOf.get(b) ?? []) for (const v of valuesOf.get(key)!) if (v !== b) overlap.set(v, (overlap.get(v) ?? 0) + 1);
      const best = [...overlap].sort((x, y) => y[1] - x[1] || y[0].localeCompare(x[0]))[0];
      if (best) return { a: best[0], b };
    }
    return { a: values.at(-2), b: values.at(-1) };
  }, [rows, feature, values]);
  const a = link.a !== undefined && values.includes(link.a) ? link.a : defaults.a;
  const b = link.b !== undefined && values.includes(link.b) ? link.b : defaults.b;
  const setPicked = (p: { a?: string; b?: string }) => setLink(p);
  const tab = TABS.includes(link.tab as Tab) ? (link.tab as Tab) : 'worse';
  const setTab = (id: Tab) => setLink({ tab: id });
  // Values a link asked for that are not in this data.
  const unknown = [
    link.by !== undefined && !choices.includes(link.by) && `compare by ${link.by}`,
    link.a !== undefined && !values.includes(link.a) && `A = ${link.a}`,
    link.b !== undefined && !values.includes(link.b) && `B = ${link.b}`,
  ].filter(Boolean);
  const [shown, setShown] = useState(50);

  const result = useMemo(() => (a !== undefined && b !== undefined && a !== b ? compare(rows, feature, a, b, t) : undefined), [rows, feature, a, b, t]);

  if (values.length < 2)
    return <p className="muted note">Only one {feature} here: nothing to compare. Pick another “compare by”, or select more runs on the left.</p>;

  const pairs = result?.pairs ?? [];
  const worse = pairs.filter((p) => p.change === 'worse');
  const better = pairs.filter((p) => p.change === 'better');
  const labeledPairs = pairs.filter((p) => p.change !== 'unlabeled');
  const errors = (side: 'a' | 'b') => labeledPairs.reduce((s, p) => s + (1 - p[side].acc!), 0);
  const meanAbs = pairs.length ? pairs.reduce((s, p) => s + Math.abs(p.dp), 0) / pairs.length : undefined;
  const list =
    tab === 'worse'
      ? [...worse].sort((x, y) => Math.abs(y.dp) - Math.abs(x.dp))
      : tab === 'better'
        ? [...better].sort((x, y) => Math.abs(y.dp) - Math.abs(x.dp))
        : tab === 'moved'
          ? [...pairs].sort((x, y) => Math.abs(y.dp) - Math.abs(x.dp))
          : pairs;
  const short = (v: string) => (v.length > 40 ? `…${v.slice(-39)}` : v);
  const sideCell = (p: Pair, s: 'a' | 'b') => (
    <td
      className="num link-cell"
      title={`open the ${s === 'a' ? 'A' : 'B'} record`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(p[s].rows[0]);
      }}
    >
      {fmt(p[s].p)}
      {type === 'choice' && <span className="muted mono"> {p[s].choices.join(',')}</span>}
      {p[s].rows.length > 1 && <span className="muted"> ×{p[s].rows.length}</span>}
    </td>
  );

  return (
    <>
      {unknown.length > 0 && <p className="linknote">Not in this data: {unknown.join(', ')}. Showing the defaults instead.</p>}
      <div className="controls">
        <label>
          <span>Compare by</span>
          <select
            value={feature}
            onChange={(e) => {
              setLink({ by: e.target.value, a: undefined, b: undefined });
            }}
          >
            {choices.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="side">
          <span>A</span>
          <select value={a} onChange={(e) => setPicked({ a: e.target.value, b })}>
            {values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <button className="link" onClick={() => setPicked({ a: b, b: a })} title="swap A and B">
          ⇄
        </button>
        <label className="side">
          <span>B</span>
          <select value={b} onChange={(e) => setPicked({ a, b: e.target.value })}>
            {values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>

      {a === b ? (
        <p className="muted note">A and B are the same. Pick two different values.</p>
      ) : (
        <>
          <p className="muted note">
            {pairs.length} samples in both ({labeledPairs.length} labeled)
            {result && result.onlyA ? ` · ${result.onlyA} only in A` : ''}
            {result && result.onlyB ? ` · ${result.onlyB} only in B` : ''}
            {result && result.noItem ? ` · ${result.noItem} answers without an item can't be lined up` : ''}. Repeats of a sample are
            averaged. Right or wrong is judged at threshold {t.toFixed(2)}.
          </p>
          <div className="tiles">
            <div className="tile">
              <div className="tile-label">
                <span className="swatch no" />
                Worse in B
              </div>
              <div className="tile-value">{worse.length}</div>
              <div className="tile-hint">right in A, wrong in B</div>
            </div>
            <div className="tile">
              <div className="tile-label">
                <span className="swatch yes" />
                Better in B
              </div>
              <div className="tile-value">{better.length}</div>
              <div className="tile-hint">wrong in A, right in B</div>
            </div>
            <div className="tile">
              <div className="tile-label">Errors A → B</div>
              <div className="tile-value">
                {labeledPairs.length ? `${Math.round(errors('a'))} → ${Math.round(errors('b'))}` : '–'}
              </div>
              <div className="tile-hint">over the labeled samples in both</div>
            </div>
            <div className="tile">
              <div className="tile-label">Mean |Δp|</div>
              <div className="tile-value">{fmt(meanAbs)}</div>
              <div className="tile-hint">how far p moved, labeled or not</div>
            </div>
          </div>

          {pairs.length > 0 && (
            <figure>
              <figcaption>
                {type === 'noul'
                  ? 'p in A against p in B, one dot per sample. Above the diagonal: B says yes more strongly.'
                  : 'Confidence in A against confidence in B, one dot per sample. Above the diagonal: B is more sure of its choice.'}{' '}
                Click a dot to open its B record.
              </figcaption>
              <PairScatter
                pairs={pairs}
                t={t}
                labels={{ a: `A ${short(a!)}`, b: `B ${short(b!)}` }}
                colors={colors}
                onPick={(p) => onOpen(p.b.rows[0])}
              />
            </figure>
          )}

          <section className="cases">
            <div className="tabs" role="tablist">
              {(
                [
                  ['worse', `Worse (${worse.length})`],
                  ['better', `Better (${better.length})`],
                  ['moved', 'Biggest Δp'],
                  ['all', 'All'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  className={tab === id ? 'tab active' : 'tab'}
                  onClick={() => {
                    setTab(id);
                    setShown(50);
                  }}
                >
                  {label}
                </button>
              ))}
              <span className="muted">
                {list.length} samples{list.length > shown ? `, showing ${shown}` : ''}
              </span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>item</th>
                  {pooled && <th>question</th>}
                  <th>expected</th>
                  <th className="num">A p</th>
                  <th className="num">B p</th>
                  <th className="num">Δp</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, shown).map((p) => (
                  <tr key={`${p.item}/${p.question}`} onClick={() => onOpen(p.b.rows[0])}>
                    <td className="clip mono" title={p.item}>
                      {p.item}
                    </td>
                    {pooled && <td className="mono">{p.question}</td>}
                    <td>
                      {p.expected === undefined ? (
                        <span className="muted">–</span>
                      ) : (
                        <span className={p.change === 'worse' ? 'bad' : p.change === 'better' ? 'ok' : ''}>{String(p.expected)}</span>
                      )}
                    </td>
                    {sideCell(p, 'a')}
                    {sideCell(p, 'b')}
                    <td className={`num ${p.change === 'worse' ? 'bad' : p.change === 'better' ? 'ok' : ''}`}>
                      {p.dp >= 0 ? '+' : ''}
                      {p.dp.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {list.length > shown && (
              <button className="more" onClick={() => setShown(shown + 200)}>
                Show {Math.min(200, list.length - shown)} more
              </button>
            )}
          </section>
        </>
      )}
    </>
  );
}
