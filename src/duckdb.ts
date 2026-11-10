/**
 * DuckStore: an index of the log in a DuckDB file.
 *
 * The JSONL files stay the source of truth. On open, the store compares the files under the
 * given paths with what it indexed last time (by size and modification time), drops what changed
 * or disappeared, and reads only new or changed files. Deleting the index file is always safe.
 *
 * Tables (one row per …):
 *   files        indexed file: path, size, mtime
 *   records      call: id, run, the record as JSON (for /api/record)
 *   answers      answered question of a call, with the record's own label
 *   labels       label line
 *   definitions  question version: id → definition as sent
 *   skipped      line that was neither a record nor a label
 *   rows         answers joined with label lines, with y derived; rebuilt after every change.
 *                Same meaning as Row in format.ts; test/store.test.ts checks both give the same rows.
 */
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance, listValue, type DuckDBAppender, type DuckDBConnection } from '@duckdb/node-api';
import type { Overview, QuestionCount, RowQuery, RowResult, RunSummary, Store } from './api.ts';
import { answerRows, type DecisionRecord } from './format.ts';
import { jsonlFiles, readLog } from './load.ts';
import { byName } from './store.ts';

/** Bump when a table or a derived column changes: the index is then rebuilt from the files. */
const SCHEMA = '1';

const TABLES = `
CREATE TABLE IF NOT EXISTS meta (key VARCHAR PRIMARY KEY, value VARCHAR);
CREATE TABLE IF NOT EXISTS files (path VARCHAR PRIMARY KEY, size BIGINT, mtime DOUBLE);
CREATE TABLE IF NOT EXISTS records (file VARCHAR, line INTEGER, id VARCHAR, run VARCHAR, json VARCHAR);
CREATE TABLE IF NOT EXISTS answers (
  file VARCHAR, line INTEGER, ord INTEGER, id VARCHAR, run VARCHAR, item VARCHAR, question VARCHAR, type VARCHAR,
  p DOUBLE, choice VARCHAR, value DOUBLE, expected VARCHAR, threshold DOUBLE, qv VARCHAR, model VARCHAR,
  backend VARCHAR, ms DOUBLE, tags VARCHAR);
CREATE TABLE IF NOT EXISTS labels (file VARCHAR, line INTEGER, item VARCHAR, question VARCHAR, expected VARCHAR);
CREATE TABLE IF NOT EXISTS definitions (qv VARCHAR PRIMARY KEY, json VARCHAR);
CREATE TABLE IF NOT EXISTS skipped (file VARCHAR, line INTEGER, reason VARCHAR);
`;

// Label lines fill in answers whose record has no label; for one item and question the last line wins.
// y follows withExpected() in format.ts.
const BUILD_ROWS = `
CREATE OR REPLACE TABLE rows AS
WITH l AS (
  SELECT item, question, arg_max(expected, file || chr(0) || lpad(line::VARCHAR, 10, '0')) AS expected
  FROM labels GROUP BY item, question
), j AS (
  SELECT a.* EXCLUDE (expected), coalesce(a.expected, l.expected) AS e
  FROM answers a LEFT JOIN l ON a.item = l.item AND a.question = l.question
)
SELECT file, line, ord, id, run, item, question, type, p, choice, value, e AS expected,
  CASE
    WHEN e IS NULL THEN NULL
    WHEN type = 'noul' THEN CASE json_type(e)
      WHEN 'BOOLEAN' THEN e = 'true'
      WHEN 'VARCHAR' THEN CASE
        WHEN lower(trim(e->>'$')) IN ('true', 'yes', '1') THEN true
        WHEN lower(trim(e->>'$')) IN ('false', 'no', '0') THEN false
      END
      ELSE TRY_CAST(e AS DOUBLE) >= 0.5
    END
    WHEN type = 'choice' THEN (CASE WHEN json_type(e) = 'VARCHAR' THEN e->>'$' ELSE e END) = choice
  END AS y,
  threshold, qv, model, backend, ms, tags
FROM j`;

export interface SyncReport {
  files: number;
  /** Files read this time (new or changed). */
  read: number;
  /** Files dropped from the index (changed or gone). */
  dropped: number;
  ms: number;
}

/** Appends values in column order. Integers (line numbers, positions) go in as `{ int }`. */
function put(a: DuckDBAppender, ...values: (string | number | { int: number } | undefined)[]) {
  for (const v of values) {
    if (v === undefined || v === null) a.appendNull();
    else if (typeof v === 'number') a.appendDouble(v);
    else if (typeof v === 'object') a.appendInteger(v.int);
    else a.appendVarchar(v);
  }
  a.endRow();
}

async function readAll<T>(db: DuckDBConnection, sql: string, values?: unknown[]): Promise<T[]> {
  const reader = await db.runAndReadAll(sql, values as never);
  return reader.getRowObjectsJS() as T[];
}

async function sync(db: DuckDBConnection, targets: string[]): Promise<SyncReport> {
  const started = performance.now();
  // Record ids default to the file path relative to the working directory, so a new one means a new index.
  const key = `${SCHEMA}|${process.cwd()}`;
  const [meta] = await readAll<{ value: string }>(db, `SELECT value FROM meta WHERE key = 'schema'`).catch(() => []);
  if (meta?.value !== key) {
    for (const t of ['meta', 'files', 'records', 'answers', 'labels', 'definitions', 'skipped', 'rows'])
      await db.run(`DROP TABLE IF EXISTS ${t}`);
    await db.run(TABLES);
    await db.run(`INSERT INTO meta VALUES ('schema', $1)`, [key]);
  }

  const current = new Map<string, { size: number; mtime: number }>();
  for (const target of targets)
    for (const file of await jsonlFiles(target)) {
      const s = await stat(file);
      current.set(file, { size: s.size, mtime: s.mtimeMs });
    }
  const known = new Map(
    (await readAll<{ path: string; size: number; mtime: number }>(db, 'SELECT path, size::DOUBLE AS size, mtime FROM files')).map(
      (f) => [f.path, f],
    ),
  );
  const same = (p: string) => {
    const a = known.get(p);
    const b = current.get(p);
    return !!a && !!b && a.size === b.size && a.mtime === b.mtime;
  };
  const toRead = [...current.keys()].filter((p) => !same(p)).sort();
  const toDrop = [...known.keys()].filter((p) => !same(p));
  const report = { files: current.size, read: toRead.length, dropped: toDrop.length, ms: 0 };
  const hasRows = (await readAll(db, `SELECT 1 FROM information_schema.tables WHERE table_name = 'rows'`)).length > 0;
  if (!toRead.length && !toDrop.length && hasRows) {
    report.ms = performance.now() - started;
    return report;
  }

  // Also clear files being read: a run that stopped halfway leaves rows without a files entry.
  const clear = listValue([...new Set([...toDrop, ...toRead])]);
  for (const t of ['records', 'answers', 'labels', 'skipped']) await db.run(`DELETE FROM ${t} WHERE list_contains($1, file)`, [clear]);
  await db.run(`DELETE FROM files WHERE list_contains($1, path)`, [clear]);

  const ids = new Set((await readAll<{ id: string }>(db, 'SELECT id FROM records')).map((r) => r.id));
  const versions = new Set((await readAll<{ qv: string }>(db, 'SELECT qv FROM definitions')).map((r) => r.qv));
  const app = {
    records: await db.createAppender('records'),
    answers: await db.createAppender('answers'),
    labels: await db.createAppender('labels'),
    definitions: await db.createAppender('definitions'),
    skipped: await db.createAppender('skipped'),
    files: await db.createAppender('files'),
  };
  for (const file of toRead) {
    await readLog(file, {
      record(record, line) {
        if (ids.has(record.id)) {
          put(app.skipped, file, { int: line }, `duplicate id ${record.id}`);
          return;
        }
        ids.add(record.id);
        put(app.records, file, { int: line }, record.id, record.run, JSON.stringify(record));
        const definitions = new Map<string, unknown>();
        answerRows(record, definitions).forEach((r, ord) => {
          const expected = r.expected === undefined ? undefined : JSON.stringify(r.expected);
          put(
            app.answers,
            file, { int: line }, { int: ord }, r.id, r.run, r.item, r.question, r.type, r.p, r.choice, r.value,
            expected, r.threshold, r.qv, r.model, r.backend, r.ms, JSON.stringify(r.tags),
          );
        });
        for (const [qv, def] of definitions)
          if (!versions.has(qv)) {
            versions.add(qv);
            put(app.definitions, qv, JSON.stringify(def));
          }
      },
      label(l, line) {
        put(app.labels, file, { int: line }, l.item, l.question, JSON.stringify(l.expected));
      },
      skip(line, reason) {
        put(app.skipped, file, { int: line }, reason);
      },
    });
    const s = current.get(file)!;
    app.files.appendVarchar(file);
    app.files.appendBigInt(BigInt(s.size));
    app.files.appendDouble(s.mtime);
    app.files.endRow();
  }
  for (const a of Object.values(app)) a.closeSync();
  await db.run(BUILD_ROWS);
  await db.run('CHECKPOINT');
  report.ms = performance.now() - started;
  return report;
}

// The rows table as the API returns it. DuckDB writes the JSON itself, which is several times faster
// than building objects in JS; json_merge_patch onto {} drops NULL fields, so unset fields are left out as in Row.
const ROW_FIELDS = ['id', 'run', 'item', 'question', 'type', 'p', 'choice', 'value', 'expected', 'y', 'threshold', 'qv', 'model', 'backend', 'ms', 'tags'];
const ROW_OBJECT = `json_object(${ROW_FIELDS.map((f) => `'${f}', ${f === 'expected' || f === 'tags' ? `${f}::JSON` : f}`).join(', ')})`;
const ROWS_JSON = (runs: boolean) => `
SELECT coalesce('[' || string_agg(json_merge_patch('{}', ${ROW_OBJECT})::VARCHAR, ',' ORDER BY file, line, ord) || ']', '[]') AS rows,
       coalesce(list(DISTINCT qv) FILTER (WHERE qv IS NOT NULL), []) AS versions
FROM rows WHERE list_contains($1, question) ${runs ? 'AND list_contains($2, run)' : ''}`;

export class DuckStore implements Store {
  private constructor(
    private readonly instance: DuckDBInstance,
    private readonly db: DuckDBConnection,
    readonly report: SyncReport,
  ) {}

  /** Opens (or creates) the index at `file` and brings it up to date with the logs under `targets`. */
  static async open(file: string, targets: string[]) {
    if (file !== ':memory:') await mkdir(path.dirname(file), { recursive: true });
    const instance = await DuckDBInstance.create(file);
    const db = await instance.connect();
    try {
      return new DuckStore(instance, db, await sync(db, targets));
    } catch (e) {
      db.closeSync();
      instance.closeSync();
      throw e;
    }
  }

  async overview(): Promise<Overview> {
    const [totals] = await readAll<{ calls: number; answers: number; labeled: number; skippedCount: number }>(
      this.db,
      `SELECT (SELECT count(*) FROM records)::INTEGER AS calls, (SELECT count(*) FROM rows)::INTEGER AS answers,
              (SELECT count(y) FROM rows)::INTEGER AS labeled, (SELECT count(*) FROM skipped)::INTEGER AS skippedCount`,
    );
    const runs = await readAll<RunSummary>(
      this.db,
      `SELECT run, count(*)::INTEGER AS n, coalesce(list(DISTINCT model) FILTER (WHERE model IS NOT NULL), []) AS models
       FROM rows GROUP BY run`,
    );
    const counts = await readAll<QuestionCount>(
      this.db,
      `SELECT run, question, type, count(*)::INTEGER AS n, count(y)::INTEGER AS labeled FROM rows GROUP BY run, question, type`,
    );
    const skipped = await readAll<Overview['skipped'][number]>(this.db, 'SELECT file, line, reason FROM skipped ORDER BY file, line LIMIT 50');
    for (const r of runs) r.models.sort();
    runs.sort((a, b) => byName(a.run, b.run));
    counts.sort((a, b) => byName(a.run, b.run) || byName(a.question, b.question) || byName(a.type, b.type));
    return { ...totals, runs, counts, skipped };
  }

  async rows(query: RowQuery): Promise<RowResult> {
    return JSON.parse(await this.rowsJson(query));
  }

  /** rows(), already serialized: what the server sends. */
  async rowsJson({ questions, runs }: RowQuery): Promise<string> {
    const values = [listValue(questions), ...(runs ? [listValue(runs)] : [])];
    const [found] = await readAll<{ rows: string; versions: string[] }>(this.db, ROWS_JSON(!!runs), values);
    const definitions: string[] = [];
    if (found.versions.length)
      for (const d of await readAll<{ qv: string; json: string }>(this.db, 'SELECT qv, json FROM definitions WHERE list_contains($1, qv) ORDER BY qv', [
        listValue(found.versions),
      ]))
        definitions.push(`${JSON.stringify(d.qv)}:${d.json}`);
    return `{"rows":${found.rows},"definitions":{${definitions.join(',')}}}`;
  }

  async record(id: string): Promise<DecisionRecord | undefined> {
    const [r] = await readAll<{ json: string }>(this.db, 'SELECT json FROM records WHERE id = $1 LIMIT 1', [id]);
    return r && JSON.parse(r.json);
  }

  async close() {
    this.db.closeSync();
    this.instance.closeSync();
  }
}
