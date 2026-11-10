/**
 * Metrics over rows. Pure functions, shared by the page and the tests.
 *
 * Every row with a probability `p` and a label `y` is treated the same way:
 * - noul: the call "accepts" (says yes) when p >= t; y is the expected yes/no.
 * - choice: the call is "accepted" (trusted) when its confidence p >= t; y says whether the choice was right.
 */
import type { Row } from './format.ts';

export interface Point {
  p: number;
  y: boolean;
}

export const labeled = (rows: Row[]): Point[] =>
  rows.filter((r) => r.p !== undefined && r.y !== undefined).map((r) => ({ p: r.p!, y: r.y! }));

/** Confusion counts at threshold t. For choice rows: tp = right & trusted, fp = wrong & trusted, fn = right & not trusted. */
export function confusion(points: Point[], t: number) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const { p, y } of points) {
    if (p >= t) y ? tp++ : fp++;
    else y ? fn++ : tn++;
  }
  const n = points.length;
  return {
    n, tp, fp, fn, tn,
    precision: tp + fp ? tp / (tp + fp) : undefined,
    recall: tp + fn ? tp / (tp + fn) : undefined,
    /** Share of rows at or above the threshold. */
    coverage: n ? (tp + fp) / n : undefined,
  };
}

export interface Bin {
  lo: number;
  hi: number;
  n: number;
  /** Mean predicted probability in the bin. */
  meanP: number;
  /** Observed share of positives in the bin. */
  rate: number;
}

/** Equal-width reliability bins over [0, 1]; empty bins are left out. */
export function reliability(points: Point[], bins = 10): Bin[] {
  const acc = Array.from({ length: bins }, (_, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: 0, sumP: 0, pos: 0 }));
  for (const { p, y } of points) {
    const b = acc[Math.min(bins - 1, Math.max(0, Math.floor(p * bins)))];
    b.n++;
    b.sumP += p;
    if (y) b.pos++;
  }
  return acc.filter((b) => b.n).map((b) => ({ lo: b.lo, hi: b.hi, n: b.n, meanP: b.sumP / b.n, rate: b.pos / b.n }));
}

/** Expected calibration error: bin-size-weighted mean |rate − meanP|. */
export function ece(points: Point[], bins = 10) {
  if (!points.length) return undefined;
  return reliability(points, bins).reduce((s, b) => s + (b.n / points.length) * Math.abs(b.rate - b.meanP), 0);
}

export function brier(points: Point[]) {
  if (!points.length) return undefined;
  return points.reduce((s, { p, y }) => s + (p - (y ? 1 : 0)) ** 2, 0) / points.length;
}

/** Confusion counts at every threshold 0, 0.01, …, 1. */
export function sweep(points: Point[], step = 0.01) {
  const out: ({ t: number } & ReturnType<typeof confusion>)[] = [];
  for (let i = 0; i <= Math.round(1 / step); i++) {
    const t = Math.round(i * step * 1e6) / 1e6;
    out.push({ t, ...confusion(points, t) });
  }
  return out;
}

/** The threshold most rows use, or undefined when no row carries one. */
export function usualThreshold(rows: Row[]) {
  const counts = new Map<number, number>();
  for (const r of rows) if (r.threshold !== undefined) counts.set(r.threshold, (counts.get(r.threshold) ?? 0) + 1);
  let best: number | undefined, bestN = 0;
  for (const [t, n] of counts) if (n > bestN) [best, bestN] = [t, n];
  return best;
}

/** Feature value of a row for splitting: "run", "model", "backend", "question", "version" (question as sent), or "tag:<name>". */
export function featureOf(row: Row, feature: string): string {
  if (feature === 'run') return row.run;
  if (feature === 'model') return row.model ?? '(none)';
  if (feature === 'backend') return row.backend ?? '(none)';
  if (feature === 'question') return row.question;
  if (feature === 'version') return row.qv ?? '(no request)';
  if (feature.startsWith('tag:')) {
    const v = row.tags[feature.slice(4)];
    return v === undefined ? '(none)' : String(v);
  }
  return '';
}
