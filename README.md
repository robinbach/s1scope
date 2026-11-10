# s1scope

A local viewer for logged decision-model calls: anything that speaks the System One API
(`POST /v1/systemone`), such as TypeSafe Jev, Ollama's local decision models, or OpenRouter.

Decision models answer typed questions with probabilities instead of text. To run one in production you
pick a threshold per question, and you want to know what that threshold costs: how many wrong answers
get through, how many right ones get stopped, and whether the probabilities mean what they say.
s1scope reads the calls you have already logged and shows that per question.

It does not run evaluations. Record calls however you like (there is a small `fetch` wrapper below),
add labels if you have them, and point the viewer at the folder.

## What you get

For each question (or a pool of questions matched by a pattern):

- the distribution of `p`, colored by the expected answer, with the threshold drawn on it;
- false accepts and false rejects at the threshold, precision, recall, Brier score, ECE;
- a reliability curve (predicted `p` against the observed rate);
- a threshold sweep: errors at every threshold from 0 to 1;
- split any of these by run, model, backend, question, or any tag;
- the error list at the current threshold, and the full request and response behind each row.

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

## Status

Early. Planned next: comparing two runs item by item, importers for other tools' recordings, score questions,
a Python recorder.

## License

MIT
