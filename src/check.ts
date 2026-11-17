/**
 * s1scope check <file-or-folder>... [--json]
 * Reads logs the way `view` does and reports what the viewer would see and what it would drop,
 * without starting a server or writing an index. Meant for scripts and agents that write logs.
 *
 * Errors (exit code 1): lines that are neither a record nor a label, duplicate record ids,
 * and no answers at all. Warnings (exit code 0): records with no readable answer, probabilities
 * outside 0..1, labels that cannot be read for their question, labels for items no record has.
 */
import { answersOf } from './format.ts';
import { jsonlFiles, load } from './load.ts';

export interface Problem {
  /** `file:line` for line problems, the record id for record problems, `item / question` for labels. */
  where: string;
  message: string;
}

export interface CheckReport {
  files: number;
  records: number;
  labelLines: number;
  answers: number;
  labeled: number;
  runs: { run: string; records: number; answers: number; labeled: number; questions: string[] }[];
  errors: Problem[];
  warnings: Problem[];
}

/** How many problems of each kind are listed; the rest are counted in the summary line. */
const LIST = 20;

const outOfRange = (p: number | undefined) => p !== undefined && (p < 0 || p > 1);

export async function check(targets: string[]): Promise<CheckReport> {
  let files = 0;
  for (const t of targets) files += (await jsonlFiles(t)).length;
  const data = await load(targets);
  const errors: Problem[] = [];
  const warnings: Problem[] = [];

  for (const s of data.skipped) errors.push({ where: `${s.file}:${s.line}`, message: s.reason });

  const items = new Set<string>();
  for (const record of data.records.values()) {
    if (record.item !== undefined) items.add(record.item);
    const answers = answersOf(record);
    if (!Object.keys(answers).length && !record.error)
      warnings.push({ where: record.id!, message: 'no readable answer (see "Answers" in docs/format.md)' });
    for (const [q, a] of Object.entries(answers)) {
      const p = a.type === 'noul' ? a.p : a.type === 'choice' ? a.confidence : undefined;
      if (outOfRange(p)) warnings.push({ where: record.id!, message: `${q}: probability ${p} is outside 0..1` });
    }
  }

  const runs = new Map<string, { records: Set<string>; answers: number; labeled: number; questions: Set<string> }>();
  for (const row of data.rows) {
    const run = runs.get(row.run) ?? { records: new Set(), answers: 0, labeled: 0, questions: new Set() };
    run.answers++;
    run.questions.add(row.question);
    if (row.y !== undefined) run.labeled++;
    else if (row.expected !== undefined)
      warnings.push({ where: row.id, message: `${row.question}: label ${JSON.stringify(row.expected)} is not a yes/no` });
    runs.set(row.run, run);
  }
  // Every record counts for its run, also those without a readable answer.
  for (const record of data.records.values()) {
    const run = runs.get(record.run) ?? { records: new Set(), answers: 0, labeled: 0, questions: new Set() };
    run.records.add(record.id!);
    runs.set(record.run, run);
  }

  const orphans = [...data.labels.keys()].filter((k) => !items.has(k.split('\u0000')[0]));
  for (const k of orphans) {
    const [item, question] = k.split('\u0000');
    warnings.push({ where: `${item} / ${question}`, message: 'label for an item no record has' });
  }

  const labeled = data.rows.filter((r) => r.y !== undefined).length;
  if (!data.rows.length) errors.push({ where: targets.join(', '), message: 'no answers found' });

  return {
    files,
    records: data.records.size,
    labelLines: data.labels.size,
    answers: data.rows.length,
    labeled,
    runs: [...runs]
      .map(([run, r]) => ({ run, records: r.records.size, answers: r.answers, labeled: r.labeled, questions: [...r.questions].sort() }))
      .sort((a, b) => (a.run < b.run ? -1 : a.run > b.run ? 1 : 0)),
    errors,
    warnings,
  };
}

/** Plain-text report, as `s1scope check` prints it. */
export function formatReport(r: CheckReport): string {
  const out: string[] = [];
  out.push(`${r.files} file${r.files === 1 ? '' : 's'}: ${r.records} records, ${r.labelLines} label lines, ${r.answers} answers, ${r.labeled} labeled`);
  for (const run of r.runs)
    out.push(`  ${run.run}: ${run.records} records, ${run.answers} answers, ${run.labeled} labeled; questions ${run.questions.join(', ') || '(none)'}`);
  for (const [name, list] of [
    ['error', r.errors],
    ['warning', r.warnings],
  ] as const) {
    if (!list.length) continue;
    out.push(`${list.length} ${name}${list.length === 1 ? '' : 's'}:`);
    for (const p of list.slice(0, LIST)) out.push(`  ${p.where}: ${p.message}`);
    if (list.length > LIST) out.push(`  … and ${list.length - LIST} more`);
  }
  out.push(r.errors.length ? 'FAIL' : 'OK');
  return out.join('\n');
}

/** Entry point for the CLI. Returns the exit code. */
export async function runCheck(args: string[]): Promise<number> {
  const json = args.includes('--json');
  const paths = args.filter((a) => a !== '--json');
  const unknown = paths.find((a) => a.startsWith('--'));
  if (unknown || !paths.length) {
    console.error(`${unknown ? `unknown option ${unknown}\n` : ''}usage: s1scope check <file-or-folder>... [--json]`);
    return 1;
  }
  let report: CheckReport;
  try {
    report = await check(paths);
  } catch (e) {
    console.error(String((e as Error).message ?? e));
    return 1;
  }
  console.log(json ? JSON.stringify(report, null, 2) : formatReport(report));
  return report.errors.length ? 1 : 0;
}
