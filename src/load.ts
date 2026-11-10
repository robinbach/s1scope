/** Reads s1scope logs from files and folders (Node only). */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDecisionRecord, isLabelLine, labelKey, toRows, type DecisionRecord, type Expected, type Row } from './format.ts';

export interface Loaded {
  records: Map<string, DecisionRecord>;
  labels: Map<string, Expected>;
  rows: Row[];
  /** Question definitions as sent, by version id (see Row.qv). */
  definitions: Map<string, unknown>;
  /** Lines that were neither a record nor a label, with the reason. */
  skipped: { file: string; line: number; reason: string }[];
}

async function jsonlFiles(target: string): Promise<string[]> {
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

export async function load(targets: string[]): Promise<Loaded> {
  const records = new Map<string, DecisionRecord>();
  const labels = new Map<string, Expected>();
  const skipped: Loaded['skipped'] = [];
  for (const target of targets)
    for (const file of await jsonlFiles(target)) {
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((text, i) => {
        if (!text.trim()) return;
        let value: unknown;
        try {
          value = JSON.parse(text);
        } catch {
          skipped.push({ file, line: i + 1, reason: 'not JSON' });
          return;
        }
        if (isLabelLine(value)) labels.set(labelKey(value.item, value.question), value.expected);
        else if (isDecisionRecord(value)) {
          const id = value.id ?? `${path.relative(process.cwd(), file)}:${i + 1}`;
          if (records.has(id)) skipped.push({ file, line: i + 1, reason: `duplicate id ${id}` });
          else records.set(id, { ...value, id });
        } else skipped.push({ file, line: i + 1, reason: 'neither a record (needs run + answers/response) nor a label' });
      });
    }
  const definitions = new Map<string, unknown>();
  const rows = toRows([...records.values()], labels, definitions);
  return { records, labels, rows, definitions, skipped };
}
