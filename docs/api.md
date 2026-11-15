# HTTP API

The page reads everything through three JSON endpoints on the same server. Scripts can use them too:
`s1scope view` serves them on `http://127.0.0.1:4747/` and `npm run dev` on port 5173. Responses are
gzip-compressed when the client accepts it. The types are in `src/api.ts` and `src/format.ts`.

## GET /api/overview

Totals, runs, and answer counts per run and question. It is what the sidebar shows. Before answering, the
server checks the logs for new or changed files (when the store supports it), so this is the request that
makes new logs show up.

```json
{
  "calls": 800,
  "answers": 1600,
  "labeled": 1600,
  "runs": [{ "run": "demo large model", "n": 800, "models": ["demo-large-2.1"] }],
  "counts": [{ "run": "demo large model", "question": "urgent", "type": "noul", "n": 400, "labeled": 400 }],
  "skipped": [],
  "skippedCount": 0
}
```

| field | meaning |
| --- | --- |
| `calls`, `answers`, `labeled` | records, answered questions, and answers with a label |
| `runs[]` | each run with its answer count and the models it used |
| `counts[]` | answers and labeled answers per run and question; the page sums these over the selected runs |
| `skipped[]`, `skippedCount` | the first lines that were neither a record nor a label, with the reason, and how many there were |

## POST /api/rows

The answers to one or more questions, one row per question per call.

Request:

```json
{ "questions": ["urgent"], "runs": ["demo small model"] }
```

`questions` is required. Leave `runs` out for every run. Anything else gets `400` with an `error` message.

Response:

```json
{
  "rows": [
    {
      "id": "demo small model#1", "run": "demo small model", "item": "ticket-001",
      "question": "urgent", "type": "noul", "p": 0.89, "expected": true, "y": true,
      "threshold": 0.5, "qv": "587f4476", "model": "demo-small-1.0", "backend": "demo",
      "ms": 177, "tags": { "lang": "en" }
    }
  ],
  "definitions": { "587f4476": { "type": "noul", "instructions": "Is this ticket urgent?" } }
}
```

| row field | meaning |
| --- | --- |
| `id` | the record (call) id; use it with `/api/record` |
| `run`, `item`, `question`, `type` | where the answer comes from; `type` is `noul`, `choice` or `score` |
| `p` | yes/no: P(yes); choice: confidence of the chosen option; missing for scores |
| `choice`, `value` | the chosen option (choice), the score (score) |
| `expected` | the label, as written |
| `y` | the label read as a boolean: yes/no, the expected answer; choice, whether the choice is right |
| `threshold` | the threshold the calling app uses, if logged |
| `qv` | question version: a hash of the question as sent; its text is in `definitions` |
| `model`, `backend`, `ms`, `tags` | model as resolved, who served it, latency, and the call's tags |

## GET /api/record?id=…

One decision record exactly as logged (see [the log format](format.md)), or `404` with `{"error": "not found"}`.
The page uses it for the call panel.

## Errors

Every error is JSON, `{"error": "…"}`, with status `400` for a bad request, `404` for an unknown record,
`405` for `/api/rows` without POST, and `500` for anything else.

## The Store interface

The server answers from a `Store` (`src/api.ts`). Two implement it:

| store | used by | how |
| --- | --- | --- |
| `DuckStore` (`src/duckdb.ts`) | `view` by default, `npm run dev` | an index in a DuckDB file, synced by file size and modification time |
| `MemoryStore` (`src/store.ts`) | `view --memory`, `S1SCOPE_MEMORY=1` | every file read into memory at start |

A store implements `overview()`, `rows(query)`, `record(id)` and `close()`. Two methods are optional:
`rowsJson(query)`, rows already serialized, for stores that can produce JSON faster than building objects;
and `refresh()`, which picks up changed log files and says whether anything changed.
`test/store.test.ts` checks that both stores return the same rows.
