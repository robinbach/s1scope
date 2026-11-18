# Getting started

s1scope needs Node 20 or later. It runs on your machine, serves on `127.0.0.1` only, and uploads nothing.

## Install and build

```sh
git clone https://github.com/robinbach/s1scope.git
cd s1scope
npm install
npm run build
```

`npm run build` type-checks, builds the page into `dist/web/` and the server into `dist/src/`.

## Try it on the demo data

```sh
npx tsx scripts/make-demo.ts        # writes examples/demo/
node dist/src/cli.js view examples/demo
```

Open `http://127.0.0.1:4747/`. The demo is synthetic: two models answer the same 400 support tickets, with a
yes/no question (`urgent`) and a choice question (`team`), and every answer has a label. The larger model is
sharper but overconfident on German tickets, which [Comparing runs](compare.md#example) walks through.

## View your own logs

Point the viewer at a file or a folder of `.jsonl` files; folders are searched recursively.

```sh
node dist/src/cli.js view logs/
```

The log format is in [Logging calls](format.md). From Node, `recordingFetch` in `src/record.ts` writes it for you.
The first start indexes every file into `.s1scope/index.duckdb`; later starts, and every page reload, read only
new or changed files. Options are in [Links and CLI](reference.md#command-line).

## Then

1. Pick a question in the sidebar and read its tiles and charts: [Reading the dashboard](dashboard.md).
2. Move the threshold and watch the errors trade against each other in the threshold sweep.
3. Compare two runs or models sample by sample: [Comparing runs](compare.md).
4. Copy the link in the top bar to share exactly what you are looking at.

## Develop

```sh
S1SCOPE_DATA=examples/demo npm run dev     # http://127.0.0.1:5173/, with hot reload
npm test
npm run test:e2e                            # the page in Chromium; first: npx playwright install chromium
```

The dev server uses its own index, `.s1scope/dev.duckdb`, so it can run next to `view`.
See [Development server](reference.md#development-server).
