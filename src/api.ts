/**
 * The viewer's data API: what the page asks for and what a store answers.
 * Types only, so the page can import them without pulling in Node code.
 *
 *   GET  /api/overview          → Overview   (sidebar: runs and per-run question counts)
 *   POST /api/rows  RowQuery    → RowResult  (one question, or a pooled set, in the chosen runs)
 *   GET  /api/record?id=…       → DecisionRecord (the raw call)
 */
import type { DecisionRecord, Row } from './format.ts';

export interface RunSummary {
  run: string;
  /** Answers in this run. */
  n: number;
  models: string[];
}

/** Answers to one question in one run. The page sums these over the runs it has selected. */
export interface QuestionCount {
  run: string;
  question: string;
  type: Row['type'];
  n: number;
  labeled: number;
}

export interface Overview {
  calls: number;
  answers: number;
  labeled: number;
  runs: RunSummary[];
  counts: QuestionCount[];
  /** The first few skipped lines, and how many there were. */
  skipped: { file: string; line: number; reason: string }[];
  skippedCount: number;
}

export interface RowQuery {
  questions: string[];
  /** Leave out for every run. */
  runs?: string[];
}

export interface RowResult {
  rows: Row[];
  /** Definitions of the question versions among the rows (see Row.qv). */
  definitions: Record<string, unknown>;
}

/** Where the viewer's data comes from. MemoryStore (store.ts) and DuckStore (duckdb.ts) implement it. */
export interface Store {
  overview(): Promise<Overview>;
  rows(query: RowQuery): Promise<RowResult>;
  /** Optional: rows() already serialized as JSON, for stores that can produce it faster. */
  rowsJson?(query: RowQuery): Promise<string>;
  record(id: string): Promise<DecisionRecord | undefined>;
  close(): Promise<void>;
}
