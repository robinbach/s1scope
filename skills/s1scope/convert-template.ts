/**
 * Template: convert your own test output into s1scope logs (format version 0).
 *
 * Copy this file into your project, replace the parts marked TODO, and run it:
 *
 *   npx tsx convert.ts --out s1s-logs results/            # one .jsonl per run in s1s-logs/
 *   node <s1scope>/dist/src/cli.js check s1s-logs          # validate
 *   node <s1scope>/dist/src/cli.js view s1s-logs           # look at it on http://127.0.0.1:4747/
 *
 * It has no dependencies and does not import s1scope, so it runs from any repository.
 * The format is documented in docs/format.md of the s1scope repository.
 *
 * The example input is a hypothetical `results.json`:
 *
 *   { "model": "my-model-1.2", "started": "2026-11-01T09:00:00Z",
 *     "cases": [ { "id": "ticket-001", "lang": "en", "ms": 120,
 *                  "questions": { "urgent": { "type": "noul", "instructions": "Is this urgent?" } },
 *                  "got": { "urgent": 0.91 },
 *                  "expect": { "urgent": true } } ] }
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// ---- the s1scope format, the parts a converter writes ----

type Answer =
  | { type: 'noul'; p: number } // p = P(yes)
  | { type: 'choice'; choice: string; confidence?: number; probabilities?: Record<string, number> }
  | { type: 'score'; value: number; probabilities?: Record<string, number> };
type Expected = boolean | string | number; // yes/no → boolean, choice → option id, score → number
type TagValue = string | number | boolean;

interface DecisionRecord {
  v: 0;
  id: string; // unique and stable across reconversions
  run: string; // one batch; the viewer groups runs by the first word
  item?: string; // the sample; the same item in two runs lines up in Compare
  ts?: string;
  backend?: string;
  model?: string;
  model_resolved?: string;
  request?: { questions?: Record<string, unknown>; [key: string]: unknown };
  response?: unknown;
  answers?: Record<string, Answer>;
  labels?: Record<string, Expected>;
  thresholds?: Record<string, number>;
  ms?: number;
  status?: number;
  error?: string;
  tags?: Record<string, TagValue>;
}

// ---- TODO: describe your input ----

interface Case {
  id: string;
  lang?: string;
  ms?: number;
  questions?: Record<string, unknown>;
  got?: Record<string, number | string>;
  expect?: Record<string, Expected>;
  error?: string;
}
interface ResultsFile {
  model?: string;
  started?: string;
  cases: Case[];
}

/** TODO: the thresholds your application uses, per question. Leave a question out if it has none. */
const THRESHOLDS: Record<string, number> = { urgent: 0.5 };

/** TODO: which input files this converter understands. */
const isInput = (file: string) => path.basename(file) === 'results.json';

/** TODO: name the run. Put a stable word first (the viewer groups by it), then what tells runs apart. */
function runName(file: string, data: ResultsFile): string {
  const batch = path.basename(path.dirname(file)); // e.g. the timestamped output folder
  return `eval ${batch}${data.model ? ` ${data.model}` : ''}`;
}

/** TODO: turn one raw answer into an s1scope answer. Return undefined to drop it. */
function toAnswer(question: string, raw: number | string): Answer | undefined {
  if (typeof raw === 'number') return { type: 'noul', p: raw };
  return { type: 'choice', choice: raw }; // add confidence if your output has it
}

function convert(file: string, data: ResultsFile): DecisionRecord[] {
  const run = runName(file, data);
  return data.cases.map((c): DecisionRecord => {
    const answers: Record<string, Answer> = {};
    for (const [q, raw] of Object.entries(c.got ?? {})) {
      const a = toAnswer(q, raw);
      if (a) answers[q] = a;
    }
    const thresholds = Object.fromEntries(Object.keys(answers).filter((q) => q in THRESHOLDS).map((q) => [q, THRESHOLDS[q]]));
    return {
      v: 0,
      // When one case makes several calls, give each its own id (e.g. `#2`) and keep the same item.
      id: `${run}/${c.id}`,
      run,
      item: c.id,
      ts: data.started,
      model: data.model,
      // The question definitions as sent: the viewer fingerprints them, so wording changes are not pooled.
      request: c.questions ? { questions: c.questions } : undefined,
      answers,
      labels: c.expect,
      thresholds,
      ms: c.ms,
      // A record needs answers, a response or an error. Keep failed calls: they show up as errors.
      error: c.error ?? (Object.keys(answers).length ? undefined : 'no answer'),
      // Tags are flat: string, number or boolean values only. Anything you want to filter or split by.
      tags: { ...(c.lang ? { lang: c.lang } : {}) },
    };
  });
}

// ---- walk the inputs, write one file per run ----

async function* walk(p: string): AsyncGenerator<string> {
  const info = await stat(p);
  if (info.isFile()) {
    if (isInput(p)) yield p;
    return;
  }
  for (const name of (await readdir(p)).sort()) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    yield* walk(path.join(p, name));
  }
}

const args = process.argv.slice(2);
const at = args.indexOf('--out');
const outDir = at >= 0 ? args[at + 1] : 's1s-logs';
const inputs = args.filter((_, i) => at < 0 || (i !== at && i !== at + 1));
if (!inputs.length) {
  console.error('usage: npx tsx convert.ts [--out s1s-logs] <file or folder>...');
  process.exit(1);
}

await mkdir(outDir, { recursive: true });
let total = 0;
for (const input of inputs)
  for await (const file of walk(input)) {
    const records = convert(file, JSON.parse(await readFile(file, 'utf8')) as ResultsFile);
    if (!records.length) continue;
    // One file per run, overwritten on every conversion, so reconverting never duplicates records.
    const out = path.join(outDir, `${records[0].run.replace(/[^\w.-]+/g, '_')}.jsonl`);
    await writeFile(out, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
    console.log(`${records[0].run}: ${records.length} records → ${out}`);
    total += records.length;
  }
console.log(`${total} records in ${outDir}`);
