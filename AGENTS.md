# AGENTS.md

Notes for coding agents working in this repository. Humans: start with [README.md](README.md).

## What this is

s1scope is a local viewer for logged decision-model calls (System One API, `POST /v1/systemone`). It reads JSONL
logs, indexes them in DuckDB, and serves a React page on `127.0.0.1` with per-question distributions, thresholds,
calibration and run comparisons. It never calls a model and never uploads anything.

- Log format (the contract with every producer): [docs/format.md](docs/format.md), types in `src/format.ts`.
- Converting another project's test output into logs: [skills/s1scope/SKILL.md](skills/s1scope/SKILL.md).

## Commands

```sh
npm install
npm run build                                   # type-check, build dist/web and dist/src
npm test                                        # node:test via tsx, test/*.test.ts
npm run test:e2e                                # builds the page, then drives it in Chromium (test/e2e/)
npx tsx scripts/make-demo.ts                    # synthetic logs in examples/demo/
node dist/src/cli.js check examples/demo        # validate logs, exit 1 on errors
node dist/src/cli.js view examples/demo         # http://127.0.0.1:4747/
S1SCOPE_DATA=examples/demo npm run dev          # Vite with hot reload, http://127.0.0.1:5173/
```

`view` keeps an index in `.s1scope/index.duckdb` and the dev server in `.s1scope/dev.duckdb`. A DuckDB file can be
open in one process only; if `view` says "in use", another s1scope has it.

## Layout

| path | what |
| --- | --- |
| `src/format.ts` | the log format: records, label lines, answer parsing, rows, question versions |
| `src/load.ts`, `src/store.ts` | reading logs; `MemoryStore` |
| `src/duckdb.ts` | `DuckStore`, the DuckDB index used by default |
| `src/server.ts`, `src/api.ts` | HTTP API (`/api/overview`, `/api/rows`, `/api/record`) and the `Store` interface |
| `src/cli.ts`, `src/check.ts` | `s1scope view` and `s1scope check` |
| `src/record.ts` | `recordingFetch`: writes logs from Node |
| `web/` | the React page; `web/url.ts` holds the link parameters |
| `docs/` | user guides; the page shows them on its Document page |
| `test/` | `node:test` tests, one file per area |
| `test/e2e/` | page tests: the built page in Chromium, against the real server on a small fixed log |
| `scripts/make-demo.ts` | demo data generator |
| `skills/s1scope/` | skill for agents in other repositories: converter template, example log |

## Rules

- All repository content is English: code, comments, docs, commit messages, PR text.
- The log format is a public contract. Changes stay backward compatible with `v: 0` logs, and go together:
  `src/format.ts`, `docs/format.md`, `test/format.test.ts`, and `skills/s1scope/` when it is affected.
- Both stores must return the same rows; `test/store.test.ts` checks it. A change to row building goes into both.
- The dashboard's "?" buttons link to headings in `docs/`; `test/markdown.test.ts` fails when a heading they use is
  renamed. Update the link in `web/` together with the heading.
- A new CLI option, link parameter or endpoint is documented in `docs/reference.md` or `docs/api.md`.
- A change to the page (`web/`) runs `npm run test:e2e` too. A page bug that a click could have caught gets a test
  there. The first run on a machine needs `npx playwright install chromium`.
- Commit messages: a short imperative subject, then a blank line and bullet points on what changed.

## Do not touch

These are gitignored and local to one machine. Do not read them into tracked files, and do not commit them:

- `data/`: real logs, possibly with private content.
- `private/`: converters for private projects. Generic lessons go into `skills/s1scope/`, never their details.
- `.s1scope/`: DuckDB indexes, rebuilt on demand; safe to delete, not to edit.
- `dist/`, `examples/demo/`: build output and generated demo data.
