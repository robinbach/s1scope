/**
 * The s1scope log format, version 0. See docs/format.md.
 *
 * A log is a set of JSONL files. Each line is either a decision record (one call to a
 * System One endpoint) or a label line (the expected answer for one question on one item).
 */

/** One answer, normalized. `p` is what thresholds apply to. */
export type Answer =
  | { type: 'noul'; p: number }
  | { type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { type: 'score'; value: number; probabilities?: Record<string, number> };

/** Expected answer: true/false for a yes/no question, an option id for a choice, a number for a score. */
export type Expected = boolean | string | number;

export type TagValue = string | number | boolean;

export interface DecisionRecord {
  /** Format version. */
  v?: 0;
  /** Unique within the loaded files. Filled from file name and line number when missing. */
  id?: string;
  /** The batch this call belongs to: one eval run, one load test, one day of production traffic. */
  run: string;
  /** ISO time the call was made. */
  ts?: string;
  /** The sample this call was made for. Records with the same item line up across runs. */
  item?: string;
  /** Who served the call, e.g. "typesafe", "ollama", "openrouter". */
  backend?: string;
  /** Endpoint URL, without credentials. */
  endpoint?: string;
  /** Model as requested (may be an alias such as "jev-latest"). */
  model?: string;
  /** Model as reported by the server (e.g. "jev-1.13.0"). */
  model_resolved?: string;
  /** The request body as sent: state (or document), questions, model. */
  request?: { state?: unknown; document?: unknown; questions?: Record<string, unknown>; [key: string]: unknown };
  /** The response body as received. */
  response?: unknown;
  /** Normalized answers. When missing, read from `response`. */
  answers?: Record<string, Answer>;
  /** Expected answers for questions in this call. Label lines can supply them too. */
  labels?: Record<string, Expected>;
  /** The thresholds the calling application uses for each question. */
  thresholds?: Record<string, number>;
  ms?: number;
  status?: number;
  request_id?: string;
  error?: string;
  usage?: { input?: number; output?: number };
  /** Any features to filter or split by: prompt version, sample category, language… */
  tags?: Record<string, TagValue>;
}

export interface LabelLine {
  item: string;
  question: string;
  expected: Expected;
}

/** One question of one call: the unit every chart and table works on. */
export interface Row {
  /** Record id. */
  id: string;
  run: string;
  item?: string;
  question: string;
  type: Answer['type'];
  /** noul: P(yes). choice: confidence of the chosen option. score: undefined. */
  p?: number;
  choice?: string;
  value?: number;
  expected?: Expected;
  /** noul: the label as a boolean. choice: whether the chosen option matches the label. */
  y?: boolean;
  threshold?: number;
  model?: string;
  backend?: string;
  ms?: number;
  tags: Record<string, TagValue>;
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : undefined);

function numberMap(x: unknown): Record<string, number> | undefined {
  if (!isObject(x)) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(x)) if (num(v) !== undefined) out[k] = v as number;
  return out;
}

/**
 * Reads one answer from a System One response. Accepts the shapes seen in the wild:
 * `{type:"noul", noul:0.2}`, `{choice, confidence, probabilities}` (with or without `type`),
 * `{type:"score", score|value, probabilities}`. Returns undefined for anything else.
 */
export function readAnswer(raw: unknown): Answer | undefined {
  if (!isObject(raw)) return undefined;
  if (raw.type === 'noul' || 'noul' in raw) {
    const p = num(raw.noul) ?? num(raw.p) ?? num(raw.probability);
    return p === undefined ? undefined : { type: 'noul', p };
  }
  if (raw.type === 'score' || 'score' in raw) {
    const value = num(raw.score) ?? num(raw.value);
    return value === undefined ? undefined : { type: 'score', value, probabilities: numberMap(raw.probabilities) };
  }
  if (typeof raw.choice === 'string') {
    const probabilities = numberMap(raw.probabilities);
    const confidence = num(raw.confidence) ?? probabilities?.[raw.choice];
    return { type: 'choice', choice: raw.choice, confidence, probabilities };
  }
  return undefined;
}

/** Answers of a record: the normalized `answers` field, else read from `response.answers`. */
export function answersOf(record: DecisionRecord): Record<string, Answer> {
  if (record.answers) return record.answers;
  const raw = isObject(record.response) ? record.response.answers : undefined;
  const out: Record<string, Answer> = {};
  if (isObject(raw))
    for (const [q, a] of Object.entries(raw)) {
      const answer = readAnswer(a);
      if (answer) out[q] = answer;
    }
  return out;
}

/** The model the server reported, falling back to the one requested. */
export function modelOf(record: DecisionRecord) {
  const reported = isObject(record.response) && typeof record.response.model === 'string' ? record.response.model : undefined;
  return record.model_resolved ?? reported ?? record.model;
}

export function isLabelLine(x: unknown): x is LabelLine {
  return isObject(x) && typeof x.item === 'string' && typeof x.question === 'string' && 'expected' in x && !('run' in x);
}

export function isDecisionRecord(x: unknown): x is DecisionRecord {
  return isObject(x) && typeof x.run === 'string' && ('answers' in x || 'response' in x || 'error' in x);
}

export const labelKey = (item: string, question: string) => `${item}\u0000${question}`;

/** Expected label as a yes/no, or undefined when it can't be read as one. */
function asBool(expected: Expected): boolean | undefined {
  if (typeof expected === 'boolean') return expected;
  if (typeof expected === 'number') return expected >= 0.5;
  const s = expected.trim().toLowerCase();
  if (['true', 'yes', '1'].includes(s)) return true;
  if (['false', 'no', '0'].includes(s)) return false;
  return undefined;
}

/** Flattens records into one row per question, joining labels (record labels win over label lines). */
export function toRows(records: DecisionRecord[], labels: Map<string, Expected> = new Map()): Row[] {
  const rows: Row[] = [];
  for (const record of records) {
    const model = modelOf(record);
    for (const [question, answer] of Object.entries(answersOf(record))) {
      const expected =
        record.labels?.[question] ?? (record.item !== undefined ? labels.get(labelKey(record.item, question)) : undefined);
      const row: Row = {
        id: record.id!,
        run: record.run,
        item: record.item,
        question,
        type: answer.type,
        expected,
        threshold: record.thresholds?.[question],
        model,
        backend: record.backend,
        ms: record.ms,
        tags: record.tags ?? {},
      };
      if (answer.type === 'noul') {
        row.p = answer.p;
        if (expected !== undefined) row.y = asBool(expected);
      } else if (answer.type === 'choice') {
        row.p = answer.confidence;
        row.choice = answer.choice;
        if (expected !== undefined) row.y = String(expected) === answer.choice;
      } else {
        row.value = answer.value;
      }
      rows.push(row);
    }
  }
  return rows;
}
