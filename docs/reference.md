# Links and CLI

## Command line

```sh
s1scope view <file-or-folder>... [--port 4747] [--db .s1scope/index.duckdb] [--memory]
```

`view` reads every `.jsonl` file under the given paths (folders are searched recursively) and serves the viewer
on `http://127.0.0.1:<port>/`. It listens on the loopback address only and uploads nothing.

| option | default | effect |
| --- | --- | --- |
| `--port <n>` | `4747` | port to serve on |
| `--db <file>` | `.s1scope/index.duckdb` | where the index is kept, relative to the working directory |
| `--memory` | off | no index: read every file into memory at each start |

From a checkout without installing, run `node dist/src/cli.js view …` after `npm run build`,
or `npm run view -- <paths>`.

```sh
s1scope check <file-or-folder>... [--json]
```

`check` reads the same files as `view` without serving anything or writing an index, and prints the records,
answers and labeled answers per run, then any problems. It exits with 1 on errors: lines that are not JSON or are
neither a record nor a label, duplicate record ids, or no answers at all. Warnings do not change the exit code:
records with no readable answer, probabilities outside 0 to 1, yes/no labels that are not a yes or no, and labels
for items no record has. `--json` prints the report as JSON instead.

## The index

By default the viewer keeps an index of the logs in a DuckDB file.

- **First start** reads every file. **Later starts** compare each file's size and modification time with
  what was indexed, drop files that changed or disappeared, and read only new or changed ones.
- **Reloading the page** does the same check, so new log files show up without a restart.
- The JSONL files stay the source. Deleting the index is always safe; the next start rebuilds it.
- A DuckDB file can be open in one process at a time. If another `s1scope` already has it, `view` stops with
  "in use": stop the other one, or pass `--db` with another file.

`--memory` skips the index. It is simpler, but reads everything at every start and does not pick up new files
until restarted.

## Development server

```sh
S1SCOPE_DATA=examples/demo npm run dev
```

Runs Vite on `http://127.0.0.1:5173/` with hot reload for the page. The data API is the same as `view`'s.

| variable | default | effect |
| --- | --- | --- |
| `S1SCOPE_DATA` | `data` | paths to read, separated by `,` or `;` |
| `S1SCOPE_DB` | `.s1scope/dev.duckdb` | the dev server's index, separate from `view`'s so both can run at once |
| `S1SCOPE_MEMORY` | unset | `1` holds everything in memory instead of using an index |

## Link parameters

The page keeps its state in the address after `#`, so any view can be linked to. Every parameter is optional;
a value the data does not have falls back to the default, and the page says what it could not find.

| parameter | example | meaning |
| --- | --- | --- |
| `q` | `q=urgent` | the question shown |
| `f` | `f=/^cat_/` | question filter: text, or `/regex/` |
| `pool` | `pool=1` | pool every question matching `f` |
| `runs` | `runs=/2026-11-1/` | select the runs whose name matches: text, or `/regex/` |
| `run` | `run=a&run=b` | select exactly these runs (repeatable) |
| `norun` | `norun=a` | select every run but these (repeatable) |
| `t` | `t=0.6` | threshold, 0 to 1 |
| `split` | `split=tag:lang` | split the overview charts by `run`, `model`, `backend`, `question`, `version` or `tag:<name>` |
| `tab` | `tab=near` | table tab: `errors`, `near`, `all` in the overview; `worse`, `better`, `moved`, `all` in compare |
| `view` | `view=compare` | `overview` (default) or `compare` |
| `by`, `a`, `b` | `by=model&a=jev-1.12&b=jev-1.13` | compare: the feature to compare by, and the two values |
| `open` | `open=logs/nightly.jsonl:42` | open one call by its record id |
| `filter` | `filter=model&filter=tag:variant=v0&filter=tag:variant=v1` | sidebar filters, in sidebar order (repeatable): `filter=<feature>` shows a feature with every value, `filter=<feature>=<value>` keeps that value, `filter=<feature>=` keeps none; features as for `split` |

With no run parameter every run is selected. When `runs` and `run` are both given, the named runs are added to
the ones the filter matched; `norun` then removes runs from that set.

Two addresses are not dashboard views: `#docs` opens the Document page, and an empty address opens the
dashboard with its defaults.

Example: the `urgent` question in the nightly runs, at threshold 0.6, split by language:

```
http://127.0.0.1:4747/#q=urgent&runs=nightly&t=0.6&split=tag:lang
```
