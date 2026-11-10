# Log format, version 0

A log is one or more JSONL files. Every line is one JSON object, and is one of:

- a **decision record**: one call to a System One endpoint (`POST /v1/systemone`), or
- a **label line**: the expected answer for one question on one item.

Files can mix both kinds. `s1scope view` reads every `.jsonl` file under the paths you give it.

## Decision record

Required: `run`, and at least one of `answers`, `response`, `error`.

| field | type | meaning |
|---|---|---|
| `v` | `0` | format version |
| `id` | string | unique id; defaults to `<file>:<line>` |
| `run` | string | the batch: one eval run, one load test, one day of traffic |
| `ts` | string | ISO time of the call |
| `item` | string | the sample the call was made for; the same item lines up across runs |
| `backend` | string | who served it: `typesafe`, `ollama`, `openrouter`, … |
| `endpoint` | string | URL, without credentials |
| `model` | string | model as requested (may be an alias such as `jev-latest`) |
| `model_resolved` | string | model as reported by the server; defaults to `response.model` |
| `request` | object | the request body as sent (`state` or `document`, `questions`, `model`) |
| `response` | object | the response body as received |
| `answers` | object | normalized answers (below); when missing, read from `response.answers` |
| `labels` | object | question id → expected answer |
| `thresholds` | object | question id → the threshold the calling app uses |
| `ms`, `status`, `request_id`, `error` | | latency, HTTP status, server request id, failure text |
| `usage` | `{input, output}` | token counts |
| `tags` | object | any features to filter and split by (string, number or boolean values) |

### Answers

The viewer reads the answer shapes System One servers return:

```json
{"type": "noul", "noul": 0.12}
{"type": "choice", "choice": "hall", "confidence": 0.96, "probabilities": {"hall": 0.96, "front": 0.03}}
{"type": "score", "score": 3, "probabilities": {"1": 0.1, "2": 0.2, "3": 0.7}}
```

`type` may be missing on choice answers. Normalized answers in `answers` use
`{"type":"noul","p":…}`, `{"type":"choice","choice":…,"confidence":…}` and `{"type":"score","value":…}`.

What the threshold applies to:

- yes/no (`noul`): `p` = P(yes). "Accept" means `p ≥ threshold`.
- choice: `p` = confidence of the chosen option. "Trusted" means `p ≥ threshold`; right or wrong comes from the label.
- score: shown as a distribution only (for now).

## Label line

```json
{"item": "ticket-007", "question": "urgent", "expected": true}
```

`expected` is `true`/`false` for a yes/no question (also `"yes"`/`"no"`, or a number ≥ 0.5 for yes), an option id for a choice,
a number for a score. A label applies to every record with that `item`, in every run. A label inside a record (`labels`) wins.

## Example record

```json
{"v":0,"run":"nightly 2026-11-09","item":"ticket-007","backend":"typesafe","model":"jev-latest",
 "request":{"state":{"ticket":"…"},"questions":{"urgent":{"type":"noul","instructions":"Is this urgent?"}}},
 "response":{"model":"jev-1.13.0","answers":{"urgent":{"type":"noul","noul":0.82}},"usage":{"input_tokens":310,"output_tokens":22}},
 "thresholds":{"urgent":0.5},"ms":143,"status":200,"tags":{"lang":"en"}}
```
