import * as Plot from '@observablehq/plot';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Pair } from '../src/compare.ts';
import type { Row } from '../src/format.ts';
import { featureOf, labeled, reliability, sweep } from '../src/stats.ts';

export interface Colors {
  yes: string;
  no: string;
  none: string;
  ink: string;
  muted: string;
  grid: string;
}
export interface Words {
  yes: string;
  no: string;
  fp: string;
  fn: string;
}

const MAX_GROUPS = 8;

/** Reads the color tokens from CSS so charts follow light/dark mode. */
export function useColors(): Colors {
  const read = (): Colors => {
    const s = getComputedStyle(document.documentElement);
    const v = (name: string) => s.getPropertyValue(name).trim();
    return { yes: v('--series-yes'), no: v('--series-no'), none: v('--series-none'), ink: v('--text-secondary'), muted: v('--text-muted'), grid: v('--grid') };
  };
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setColors(read());
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return colors;
}

/** Group label per row; groups past the 8 largest fold into "(other)". */
function grouper(rows: Row[], split: string) {
  if (split === 'none') return () => '';
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(featureOf(r, split), (counts.get(featureOf(r, split)) ?? 0) + 1);
  const keep = new Set([...counts].sort((a, b) => b[1] - a[1]).slice(0, MAX_GROUPS).map(([k]) => k));
  return (r: Row) => (keep.has(featureOf(r, split)) ? featureOf(r, split) : '(other)');
}

/** Facet order (largest groups first, "(other)" last) and labels with the shared prefix trimmed. */
function facetScale(groups: string[]) {
  const names = [...new Set(groups)];
  const real = names.filter((g) => g !== '(other)').sort();
  const domain = [...real, ...(names.includes('(other)') ? ['(other)'] : [])];
  let prefix = real.length > 1 ? real[0] : '';
  for (const g of real) while (prefix && !g.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const short = (g: string) => {
    const s = g === '(other)' || !prefix ? g : g.slice(prefix.length) || g;
    return s.length > 22 ? `…${s.slice(-21)}` : s;
  };
  return { domain, label: null, tickFormat: short, axis: 'right' as const };
}

function usePlot(make: (width: number) => (SVGSVGElement | HTMLElement) | null, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const node = make(width);
    el.replaceChildren(...(node ? [node] : []));
  }, [width, ...deps]);
  return ref;
}

const common = (colors: Colors) => ({
  style: { color: colors.ink, background: 'transparent', fontSize: '12px', fontFamily: 'inherit' },
  marginLeft: 48,
});

const BIN_EDGES = Array.from({ length: 21 }, (_, i) => i / 20);

export function Histogram({
  rows,
  t,
  split,
  words,
  colors,
  yScale,
}: {
  rows: Row[];
  t: number;
  split: string;
  words: Words;
  colors: Colors;
  yScale: 'linear' | 'sqrt';
}) {
  const data = useMemo(() => {
    const group = grouper(rows, split);
    const rank = (cls: string) => (cls === words.yes ? 0 : cls === words.no ? 1 : 2);
    return rows
      .filter((r) => r.p !== undefined)
      .map((r) => ({ p: Math.min(r.p!, 0.999999), cls: r.y === undefined ? 'no label' : r.y ? words.yes : words.no, group: group(r) }))
      // Stack order follows first appearance: yes at the bottom, then no, then unlabeled.
      .sort((a, b) => rank(a.cls) - rank(b.cls));
  }, [rows, split, words]);
  const groups = new Set(data.map((d) => d.group)).size;
  const ref = usePlot(
    (width) =>
      Plot.plot({
        ...common(colors),
        width,
        height: split === 'none' ? 260 : Math.min(120 * groups + 40, 900),
        x: { domain: [0, 1], label: 'p', grid: false },
        y: { label: 'answers', grid: true, type: yScale },
        fy: split === 'none' ? undefined : facetScale(data.map((d) => d.group)),
        facet: { marginRight: 170 },
        color: {
          domain: [words.yes, words.no, 'no label'],
          range: [colors.yes, colors.no, colors.none],
          legend: true,
        },
        marks: [
          Plot.rectY(
            data,
            Plot.binX(
              { y: 'count' },
              { x: 'p', fill: 'cls', fy: split === 'none' ? undefined : 'group', thresholds: BIN_EDGES, inset: 1, tip: true } as Plot.BinXInputs<Plot.RectYOptions>,
            ),
          ),
          Plot.ruleY([0], { stroke: colors.muted }),
          Plot.ruleX([t], { stroke: colors.ink, strokeWidth: 2, strokeDasharray: '4,3' }),
        ],
      }),
    [data, t, colors, groups, split, yScale],
  );
  return <div ref={ref} className="chart" />;
}

export function Reliability({ rows, split, colors }: { rows: Row[]; split: string; colors: Colors }) {
  const data = useMemo(() => {
    const group = grouper(rows, split);
    const byGroup = new Map<string, Row[]>();
    for (const r of rows) {
      const g = group(r);
      const list = byGroup.get(g);
      if (list) list.push(r);
      else byGroup.set(g, [r]);
    }
    return [...byGroup].flatMap(([g, rs]) => reliability(labeled(rs)).map((b) => ({ ...b, group: g })));
  }, [rows, split]);
  const groups = new Set(data.map((d) => d.group)).size;
  const ref = usePlot(
    (width) =>
      Plot.plot({
        ...common(colors),
        width,
        height: split === 'none' ? 280 : Math.min(150 * groups + 40, 1400),
        x: { domain: [0, 1], label: 'predicted p (bin mean)' },
        y: { domain: [0, 1], label: 'observed rate', grid: true },
        r: { range: [3, 10] },
        fy: split === 'none' ? undefined : facetScale(data.map((d) => d.group)),
        facet: { marginRight: 170 },
        marks: [
          Plot.line([[0, 0], [1, 1]], { stroke: colors.muted, strokeDasharray: '3,3' }),
          Plot.line(data, { x: 'meanP', y: 'rate', fy: split === 'none' ? undefined : 'group', stroke: colors.yes, strokeWidth: 2 }),
          Plot.dot(data, {
            x: 'meanP',
            y: 'rate',
            r: 'n',
            fy: split === 'none' ? undefined : 'group',
            fill: colors.yes,
            stroke: 'var(--surface-1)',
            strokeWidth: 2,
            tip: true,
            title: (d: (typeof data)[number]) => `p ${d.lo.toFixed(1)}–${d.hi.toFixed(1)}\nmean p ${d.meanP.toFixed(3)}\nobserved ${d.rate.toFixed(3)}\n${d.n} answers`,
          }),
        ],
      }),
    [data, colors, groups, split],
  );
  return <div ref={ref} className="chart" />;
}

export function Sweep({ rows, t, split, words, colors }: { rows: Row[]; t: number; split: string; words: Words; colors: Colors }) {
  const data = useMemo(() => {
    const group = grouper(rows, split);
    const byGroup = new Map<string, Row[]>();
    for (const r of rows) {
      const g = group(r);
      const list = byGroup.get(g);
      if (list) list.push(r);
      else byGroup.set(g, [r]);
    }
    return [...byGroup].flatMap(([g, rs]) =>
      sweep(labeled(rs)).flatMap((s) => [
        { t: s.t, n: s.fp, kind: words.fp, group: g },
        { t: s.t, n: s.fn, kind: words.fn, group: g },
      ]),
    );
  }, [rows, split, words]);
  const groups = new Set(data.map((d) => d.group)).size;
  const fy = split === 'none' ? undefined : 'group';
  const ref = usePlot(
    (width) =>
      Plot.plot({
        ...common(colors),
        width,
        height: split === 'none' ? 280 : Math.min(150 * groups + 40, 1400),
        x: { domain: [0, 1], label: 'threshold' },
        y: { label: 'answers', grid: true },
        fy: split === 'none' ? undefined : facetScale(data.map((d) => d.group)),
        facet: { marginRight: 170 },
        color: { domain: [words.fp, words.fn], range: [colors.no, colors.yes], legend: true },
        marks: [
          Plot.ruleY([0], { stroke: colors.muted }),
          Plot.line(data, { x: 't', y: 'n', stroke: 'kind', fy, strokeWidth: 2 }),
          Plot.ruleX([t], { stroke: colors.ink, strokeWidth: 2, strokeDasharray: '4,3' }),
          Plot.tip(data, Plot.pointerX({ x: 't', y: 'n', fy, stroke: 'kind', title: (d: (typeof data)[number]) => `t ${d.t.toFixed(2)}\n${d.kind}: ${d.n}` })),
        ],
      }),
    [data, t, colors, groups, split],
  );
  return <div ref={ref} className="chart" />;
}

/** One dot per lined-up sample: p on side A against p on side B. */
export function PairScatter({
  pairs,
  t,
  labels,
  colors,
  onPick,
}: {
  pairs: Pair[];
  t: number;
  labels: { a: string; b: string };
  colors: Colors;
  onPick?: (p: Pair) => void;
}) {
  // Draw unchanged samples first so flips stay on top.
  const order: Record<Pair['change'], number> = { unlabeled: 0, same: 1, better: 2, worse: 3 };
  const data = useMemo(() => [...pairs].sort((x, y) => order[x.change] - order[y.change]), [pairs]);
  const ref = usePlot(
    (width) => {
      const size = Math.min(width, 520);
      const svg = Plot.plot({
        ...common(colors),
        width: size,
        height: size,
        x: { domain: [0, 1], label: `p · ${labels.a}` },
        y: { domain: [0, 1], label: `p · ${labels.b}`, grid: true },
        color: {
          domain: ['worse', 'better', 'same', 'unlabeled'],
          range: [colors.no, colors.yes, colors.none, colors.none],
          legend: true,
        },
        marks: [
          Plot.line([[0, 0], [1, 1]], { stroke: colors.muted, strokeDasharray: '3,3' }),
          Plot.ruleX([t], { stroke: colors.ink, strokeDasharray: '2,3' }),
          Plot.ruleY([t], { stroke: colors.ink, strokeDasharray: '2,3' }),
          Plot.dot(data, {
            x: (d: Pair) => d.a.p,
            y: (d: Pair) => d.b.p,
            fill: 'change',
            r: (d: Pair) => (d.change === 'worse' || d.change === 'better' ? 4 : 2.5),
            fillOpacity: (d: Pair) => (d.change === 'worse' || d.change === 'better' ? 0.9 : 0.45),
            tip: true,
            title: (d: Pair) =>
              `${d.item}\n${d.question}\nexpected ${d.expected ?? '–'}\n${labels.a}: ${d.a.p.toFixed(2)}${d.a.choices.length ? ` (${d.a.choices.join(', ')})` : ''}\n${labels.b}: ${d.b.p.toFixed(2)}${d.b.choices.length ? ` (${d.b.choices.join(', ')})` : ''}`,
          }),
        ],
      });
      if (onPick)
        svg.addEventListener('click', () => {
          const v = (svg as unknown as { value?: Pair }).value;
          if (v) onPick(v);
        });
      return svg;
    },
    [data, colors, t, labels.a, labels.b],
  );
  return <div ref={ref} className="chart" />;
}
