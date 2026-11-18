import type { Row } from '../src/format.ts';
import { featureOf } from '../src/stats.ts';

/**
 * Sidebar filters: a feature of the answers (`model`, `backend`, `version`, `question`, `tag:<name>`, the same
 * names as Split by), and the values it lets through. `values` undefined lets every answer through.
 * Values within a group are alternatives (OR); groups narrow each other (AND). Answers without the feature
 * have the value featureOf gives them, such as `(none)`.
 */
export interface FilterGroup {
  key: string;
  values?: string[];
}

/** The rows that pass every group, optionally ignoring one group (for that group's own counts). */
export function filterRows(rows: Row[], groups: FilterGroup[], ignore?: string): Row[] {
  const active = groups.filter((g) => g.values && g.key !== ignore).map((g) => [g.key, new Set(g.values)] as const);
  if (!active.length) return rows;
  return rows.filter((r) => active.every(([key, allowed]) => allowed.has(featureOf(r, key))));
}

/**
 * The features the rows can be filtered by: model, backend, question version when the rows have one, the
 * question when there is more than one (pooled), and every tag as `tag:<name>`.
 */
export function filterKeys(rows: Row[]): string[] {
  const tags = new Set<string>();
  for (const r of rows) for (const k in r.tags) tags.add(k);
  const base = ['model', 'backend'];
  if (rows.some((r) => r.qv)) base.push('version');
  if (rows.some((r) => r.question !== rows[0].question)) base.push('question');
  return [...base, ...[...tags].sort((a, b) => a.localeCompare(b)).map((k) => `tag:${k}`)];
}

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

/** What one group's checkboxes show: every value the rows have, sorted, counted among the answers the other groups let through. */
export function facet(rows: Row[], groups: FilterGroup[], key: string): [string, number][] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(featureOf(r, key), 0);
  for (const r of filterRows(rows, groups, key)) {
    const v = featureOf(r, key);
    counts.set(v, counts.get(v)! + 1);
  }
  return [...counts].sort(([a], [b]) => byText(a, b));
}

/** Turns one value on or off. Back to every value of `all` means no restriction. */
export function toggleValue(g: FilterGroup, all: string[], value: string, on: boolean): FilterGroup {
  const next = new Set(g.values ?? all);
  if (on) next.add(value);
  else next.delete(value);
  const everything = all.every((v) => next.has(v)) && [...next].every((v) => all.includes(v));
  return { key: g.key, values: everything ? undefined : [...next].sort(byText) };
}

/**
 * Address parameters: `filter=<feature>` for a group that lets everything through, `filter=<feature>=<value>`
 * per value let through, and `filter=<feature>=` for a group with nothing ticked.
 */
export function formatFilters(groups: FilterGroup[]): string[] {
  return groups.flatMap((g) => (g.values ? (g.values.length ? g.values.map((v) => `${g.key}=${v}`) : [`${g.key}=`]) : [g.key]));
}

/** The inverse of formatFilters. The feature ends at the first `=`; values can contain one. */
export function parseFilters(params: string[]): FilterGroup[] {
  const groups = new Map<string, FilterGroup>();
  for (const p of params) {
    const at = p.indexOf('=');
    const key = at < 0 ? p : p.slice(0, at);
    if (!key) continue;
    const g = groups.get(key) ?? { key };
    groups.set(key, g);
    if (at >= 0) {
      const v = p.slice(at + 1);
      g.values = g.values ?? [];
      if (v && !g.values.includes(v)) g.values.push(v);
    }
  }
  return [...groups.values()];
}
