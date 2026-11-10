/** MemoryStore: the whole log in memory. Fine for small logs and tests; `s1scope view --memory` uses it. */
import type { Overview, QuestionCount, RowQuery, RowResult, RunSummary, Store } from './api.ts';
import type { Row } from './format.ts';
import { load, type Loaded } from './load.ts';

/** Plain code-unit order, the same in every locale. */
export const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Sidebar numbers from rows: answers per run, and per run and question. */
export function summarize(rows: Row[]): Pick<Overview, 'runs' | 'counts' | 'answers' | 'labeled'> {
  const runs = new Map<string, { n: number; models: Set<string> }>();
  const counts = new Map<string, QuestionCount>();
  let labeled = 0;
  for (const r of rows) {
    const run = runs.get(r.run) ?? { n: 0, models: new Set<string>() };
    run.n++;
    if (r.model) run.models.add(r.model);
    runs.set(r.run, run);
    const key = `${r.run}\u0000${r.question}\u0000${r.type}`;
    const c = counts.get(key) ?? { run: r.run, question: r.question, type: r.type, n: 0, labeled: 0 };
    c.n++;
    if (r.y !== undefined) {
      c.labeled++;
      labeled++;
    }
    counts.set(key, c);
  }
  return {
    answers: rows.length,
    labeled,
    runs: [...runs]
      .map(([run, e]): RunSummary => ({ run, n: e.n, models: [...e.models].sort() }))
      .sort((a, b) => byName(a.run, b.run)),
    counts: [...counts.values()].sort((a, b) => byName(a.run, b.run) || byName(a.question, b.question) || byName(a.type, b.type)),
  };
}

export class MemoryStore implements Store {
  constructor(readonly data: Loaded) {}

  static async open(targets: string[]) {
    return new MemoryStore(await load(targets));
  }

  async overview(): Promise<Overview> {
    return {
      calls: this.data.records.size,
      ...summarize(this.data.rows),
      skipped: this.data.skipped.slice(0, 50),
      skippedCount: this.data.skipped.length,
    };
  }

  async rows({ questions, runs }: RowQuery): Promise<RowResult> {
    const qs = new Set(questions);
    const rs = runs && new Set(runs);
    const rows = this.data.rows.filter((r) => qs.has(r.question) && (!rs || rs.has(r.run)));
    const definitions: Record<string, unknown> = {};
    for (const r of rows) if (r.qv && !(r.qv in definitions)) definitions[r.qv] = this.data.definitions.get(r.qv);
    return { rows, definitions };
  }

  async record(id: string) {
    return this.data.records.get(id);
  }

  async close() {}
}
