/** Reads s1scope logs from files and folders (Node only). */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  isDecisionRecord,
  isLabelLine,
  labelKey,
  toRows,
  type DecisionRecord,
  type Expected,
  type LabelLine,
  type Row,
} from './format.ts';

export interface Skipped {
  file: string;
  line: number;
  reason: string;
}

export interface Loaded {
  records: Map<string, DecisionRecord>;
  labels: Map<string, Expected>;
  rows: Row[];
  /** Question definitions as sent, by version id (see Row.qv). */
  definitions: Map<string, unknown>;
  /** Lines that were neither a record nor a label, with the reason. */
  skipped: Skipped[];
}

/** Every .jsonl file under the given paths, sorted within each path. */
export async function jsonlFiles(target: string): Promise<string[]> {
  const info = await stat(target);
  if (info.isFile()) return [target];
  const out: string[] = [];
  for (const entry of await readdir(target, { withFileTypes: true })) {
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) out.push(...(await jsonlFiles(full)));
    else if (entry.name.endsWith('.jsonl')) out.push(full);
  }
  return out.sort();
}

/** What a log line turned out to be. Line numbers count from 1. */
export interface LineSink {
  record(record: DecisionRecord & { id: string }, line: number): void;
  label(label: LabelLine, line: number): void;
  skip(line: number, reason: string): void;
}

/** Parses one log file line by line. Records without an id get one from the file name and line number. */
export async function readLog(file: string, sink: LineSink) {
  const lines = (await readFile(file, 'utf8')).split('\n');
  lines.forEach((text, i) => {
    if (!text.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      sink.skip(i + 1, 'not JSON');
      return;
    }
    if (isLabelLine(value)) sink.label(value, i + 1);
    else if (isDecisionRecord(value)) sink.record({ ...value, id: value.id ?? `${path.relative(process.cwd(), file)}:${i + 1}` }, i + 1);
    else sink.skip(i + 1, 'neither a record (needs run + answers/response) nor a label');
  });
}

/** Loads everything into memory. Later label lines win; for duplicate record ids the first wins. */
export async function load(targets: string[]): Promise<Loaded> {
  const records = new Map<string, DecisionRecord>();
  const labels = new Map<string, Expected>();
  const skipped: Skipped[] = [];
  for (const target of targets)
    for (const file of await jsonlFiles(target))
      await readLog(file, {
        record(record, line) {
          if (records.has(record.id)) skipped.push({ file, line, reason: `duplicate id ${record.id}` });
          else records.set(record.id, record);
        },
        label(l) {
          labels.set(labelKey(l.item, l.question), l.expected);
        },
        skip(line, reason) {
          skipped.push({ file, line, reason });
        },
      });
  const definitions = new Map<string, unknown>();
  const rows = toRows([...records.values()], labels, definitions);
  return { records, labels, rows, definitions, skipped };
}
