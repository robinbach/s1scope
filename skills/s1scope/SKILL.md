---
name: s1scope
description: Turn decision-model test output (System One API, /v1/systemone) into s1scope JSONL logs, validate them with `s1scope check`, and open them in the s1scope viewer. Use when a project wants to look at thresholds, errors or calibration of its decision-model calls.
---

# s1scope logs from another project

s1scope is a local viewer for logged decision-model calls. It reads JSONL files, one call per line, and shows per
question: the distribution of `p`, false accepts and false rejects at a threshold, calibration, and run-to-run
comparisons. It never runs the model; your project produces the calls, this skill gets them into the format.

Paths below use `$S1SCOPE` for the s1scope checkout. Build it once:

```sh
npm --prefix "$S1SCOPE" install
npm --prefix "$S1SCOPE" run build
```

## 1. Decide where the logs come from

- **New calls from Node:** wrap `fetch` with `recordingFetch` from `$S1SCOPE/src/record.ts`. It writes the format
  directly, and you can skip step 2. See "Recording from Node" in `$S1SCOPE/docs/format.md`.
- **Existing test output** (results files, reports, logs): write a converter, step 2.

## 2. Write a converter

Start from [convert-template.ts](convert-template.ts): copy it into your project, fill in the `TODO` parts, and run
it with `npx tsx`. It has no dependencies. [example.jsonl](example.jsonl) shows the output to aim for: two runs of
the same three items, a yes/no question and a choice question, and label lines.

The full format is in `$S1SCOPE/docs/format.md`. What matters most:

| field | rule |
| --- | --- |
| `run` | required. One batch. The viewer groups runs by the first word, so start with a stable word (`eval …`, `nightly …`). |
| `answers` | `{"q": {"type": "noul", "p": 0.82}}` for yes/no (`p` = P(yes)); `{"type": "choice", "choice": "billing", "confidence": 0.9}` for a choice. Or log the raw `response` and let the viewer read `response.answers`. |
| `id` | unique and stable, so reconverting the same input gives the same ids. Defaults to `file:line`. |
| `item` | the sample. Use the same item for the same sample in every run: that is how Compare lines runs up. |
| `labels` | expected answers per question: `true`/`false` for yes/no, the option id for a choice. Or separate label lines `{"item", "question", "expected"}`. |
| `thresholds` | the thresholds your application really uses, per question. |
| `request.questions` | the question definitions as sent. The viewer fingerprints them so different wordings are not pooled. |
| `tags` | flat `string`, `number` or `boolean` values to filter and split by (variant, language, repetition…). |

Conventions that save trouble:

- Write one `.jsonl` file per run and overwrite it on each conversion. Never append the same run twice.
- A sample called several times in one run: same `item`, different `id`, a tag such as `rep`.
- A call that failed: keep it, with `error` set. A record needs `answers`, `response` or `error`.
- If the logs contain anything private (prompts, test secrets, customer text), write them to a gitignored folder.

## 3. Validate

```sh
node "$S1SCOPE/dist/src/cli.js" check <logs-folder>          # human-readable
node "$S1SCOPE/dist/src/cli.js" check <logs-folder> --json   # for scripts
```

`check` prints records, answers and labeled answers per run, then problems. Exit code 1 means errors: lines that
are not JSON or are neither a record nor a label, duplicate ids, or no answers at all. Warnings do not fail it but
usually mean a converter bug: records with no readable answer, probabilities outside 0..1, a yes/no label that is
not a yes/no, labels for items that no record has. Fix the converter until it prints `OK` and the per-run counts
match what you converted.

## 4. View

```sh
node "$S1SCOPE/dist/src/cli.js" view <logs-folder> --db "$S1SCOPE/.s1scope/index.duckdb"
```

Then open `http://127.0.0.1:4747/`. Without `--db` the index is created in `.s1scope/` of the current directory;
add that folder to `.gitignore` if you keep it there. New or changed files show up on page reload.

To point the person at a specific view, build a link: `#q=<question>&runs=<text or /regex/>&t=<threshold>&split=tag:<name>`,
or `#view=compare&by=run&a=<run A>&b=<run B>`. All parameters are in `$S1SCOPE/docs/reference.md`.

For numbers without the page, the same server answers `GET /api/overview` and `POST /api/rows`
(`{"questions": ["q"], "runs": ["…"]}`); see `$S1SCOPE/docs/api.md`.

## Install this skill in another repository

Copy or link this folder into the other repository's skills folder, e.g. `.claude/skills/s1scope/`
(`ln -s "$S1SCOPE/skills/s1scope" .claude/skills/s1scope`, or `mklink /J .claude\skills\s1scope %S1SCOPE%\skills\s1scope`
on Windows), and tell its agents where `$S1SCOPE` is.
