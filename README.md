# s1scope

A local viewer for logged decision-model calls: anything that speaks the System One API
(`POST /v1/systemone`), such as TypeSafe Jev, Ollama's local decision models, or OpenRouter.

Decision models answer typed questions with probabilities instead of text. To run one in production you
pick a threshold per question, and you want to know what that threshold costs: how many wrong answers
get through, how many right ones get stopped, and whether the probabilities mean what they say.
s1scope reads the calls you have already logged and shows that per question.

It does not run evaluations. Record calls however you like, add labels if you have them, and point the
viewer at the folder. It serves on 127.0.0.1 and uploads nothing.

## Features

**Per question.** Pick a question, or pool every question that matches a filter or `/regex/`:

- the distribution of `p`, colored by the expected answer, with the threshold drawn on it;
- false accepts, false rejects, precision, recall, Brier score and ECE at a threshold you can move;
- a reliability curve (predicted `p` against the observed rate) and a threshold sweep (errors at every threshold);
- the error list and the near-threshold list at the current threshold.

**Split by anything.** Every chart can be split by run, model, backend, question, question version, or any tag
recorded with the call.

**Question versions.** Each question is fingerprinted exactly as it was sent. The viewer lists every version with
its wording, answer count and the runs that used it, so results from different wordings are not pooled by accident.

**Compare two slices.** Line up two runs, models or versions sample by sample: what got worse, what got better,
how many errors before and after, and a scatter of `p` in A against `p` in B.

**Every row opens its call.** Run, sample, model as resolved by the server, latency, tags, the question as sent,
the state, every answer in the call, and the raw request and response.

**Many runs.** Runs are grouped by the first word of their name (`nightly …`, `baseline …`) and can be
selected or folded by group.

## Quick start

```sh
npm install
npm run build
npx tsx scripts/make-demo.ts        # synthetic example data in examples/demo/
node dist/src/cli.js view examples/demo
# open http://127.0.0.1:4747/
```

Development, with hot reload: `S1SCOPE_DATA=examples/demo npm run dev`.

## Logging calls

The format is JSONL, one call per line. See [docs/format.md](docs/format.md).
From Node, wrap `fetch`:

```ts
import { recordingFetch } from './src/record.ts';

const f = recordingFetch(fetch, { file: 'logs/nightly.jsonl', run: 'nightly 2026-11-09' });
await f.with({ item: 'ticket-007', tags: { lang: 'en' } })('https://api.typesafe.ai/v1/systemone', {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'jev-latest', state, questions }),
});
```

Only calls to `/systemone` URLs are recorded, and the `Authorization` header is never written.
Labels go in the same files or separate ones:

```json
{"item": "ticket-007", "question": "urgent", "expected": true}
```

## License

MIT
