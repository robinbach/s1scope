/**
 * Compare two slices of rows (two runs, two question versions, two models…) sample by sample.
 * Rows line up by item and question; repeats of the same sample on one side are averaged.
 */
import type { Row } from './format.ts';
import { featureOf } from './stats.ts';

export interface Side {
  rows: Row[];
  /** Mean p over the repeats. */
  p: number;
  /** Share of repeats decided correctly at the threshold; undefined without a label. */
  acc?: number;
  /** Chosen options, for choice questions. */
  choices: string[];
}

export type Change = 'worse' | 'better' | 'same' | 'unlabeled';

export interface Pair {
  item: string;
  question: string;
  expected?: Row['expected'];
  a: Side;
  b: Side;
  dp: number;
  change: Change;
}

export interface Comparison {
  pairs: Pair[];
  onlyA: number;
  onlyB: number;
  /** Rows on either side that have no item, so they can't be lined up. */
  noItem: number;
}

/** A row is decided correctly when "p ≥ t" agrees with its label (noul: expected yes; choice: the choice is right). */
export const correct = (r: Row, t: number) => (r.y === undefined || r.p === undefined ? undefined : (r.p >= t) === r.y);

function side(rows: Row[], t: number): Side {
  const ps = rows.map((r) => r.p!);
  const marks = rows.map((r) => correct(r, t)).filter((x) => x !== undefined) as boolean[];
  return {
    rows,
    p: ps.reduce((s, p) => s + p, 0) / ps.length,
    acc: marks.length ? marks.filter(Boolean).length / marks.length : undefined,
    choices: [...new Set(rows.map((r) => r.choice).filter((c): c is string => c !== undefined))],
  };
}

export function compare(rows: Row[], feature: string, a: string, b: string, t: number): Comparison {
  const groups = { a: new Map<string, Row[]>(), b: new Map<string, Row[]>() };
  let noItem = 0;
  for (const r of rows) {
    if (r.p === undefined) continue;
    const v = featureOf(r, feature);
    const which = v === a ? 'a' : v === b ? 'b' : undefined;
    if (!which) continue;
    if (r.item === undefined) {
      noItem++;
      continue;
    }
    const key = `${r.item}\u0000${r.question}`;
    const m = groups[which];
    m.set(key, [...(m.get(key) ?? []), r]);
  }
  const pairs: Pair[] = [];
  for (const [key, ra] of groups.a) {
    const rb = groups.b.get(key);
    if (!rb) continue;
    const sa = side(ra, t);
    const sb = side(rb, t);
    const change: Change =
      sa.acc === undefined || sb.acc === undefined ? 'unlabeled' : sb.acc < sa.acc ? 'worse' : sb.acc > sa.acc ? 'better' : 'same';
    pairs.push({
      item: ra[0].item!,
      question: ra[0].question,
      expected: ra.find((r) => r.expected !== undefined)?.expected ?? rb.find((r) => r.expected !== undefined)?.expected,
      a: sa,
      b: sb,
      dp: sb.p - sa.p,
      change,
    });
  }
  const onlyA = [...groups.a.keys()].filter((k) => !groups.b.has(k)).length;
  const onlyB = [...groups.b.keys()].filter((k) => !groups.a.has(k)).length;
  return { pairs, onlyA, onlyB, noItem };
}
