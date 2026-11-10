/**
 * Recording: wrap `fetch` so every call to a System One endpoint is appended to a JSONL log.
 *
 *   import { recordingFetch } from './src/record.ts';
 *   const f = recordingFetch(fetch, { file: 'logs/run-1.jsonl', run: 'run-1' });
 *   await f('https://api.typesafe.ai/v1/systemone', { method: 'POST', body, headers });
 *
 * Calls to other URLs pass through untouched. The Authorization header is never written.
 * Per-call fields (item, tags, labels, thresholds) go through `with`:
 * `f.with({ item: 'case-7', tags: { split: 'dev' } })(url, init)`.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DecisionRecord } from './format.ts';

export interface RecordOptions {
  /** JSONL file to append to. */
  file: string;
  run: string;
  backend?: string;
  tags?: DecisionRecord['tags'];
  /** Which URLs to record. Default: paths ending in /systemone. */
  match?: (url: string) => boolean;
}

type Extra = Pick<DecisionRecord, 'item' | 'tags' | 'labels' | 'thresholds'>;
type Fetch = typeof fetch;
export type RecordingFetch = Fetch & { with(extra: Extra): Fetch };

const stripCredentials = (url: string) => {
  try {
    const u = new URL(url);
    u.username = '';
    u.password = '';
    return u.toString();
  } catch {
    return url;
  }
};

function backendOf(url: string) {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith('typesafe.ai')) return 'typesafe';
    if (host.endsWith('openrouter.ai')) return 'openrouter';
    if (host === 'localhost' || host === '127.0.0.1') return 'local';
    return host;
  } catch {
    return undefined;
  }
}

export function recordingFetch(inner: Fetch, options: RecordOptions): RecordingFetch {
  const match = options.match ?? ((url: string) => /\/systemone\/?(\?|$)/.test(url));
  let ready: Promise<unknown> | undefined;
  let seq = 0;

  const call = (extra: Extra) =>
    (async (input: Parameters<Fetch>[0], init?: Parameters<Fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (!match(url)) return inner(input, init);
      let request: DecisionRecord['request'];
      try {
        request = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      } catch {
        request = undefined;
      }
      const started = Date.now();
      const record: DecisionRecord = {
        v: 0,
        id: `${options.run}#${++seq}-${started.toString(36)}`,
        run: options.run,
        ts: new Date(started).toISOString(),
        backend: options.backend ?? backendOf(url),
        endpoint: stripCredentials(url),
        model: typeof request?.model === 'string' ? request.model : undefined,
        request,
        ...extra,
        tags: { ...options.tags, ...extra.tags },
      };
      const write = async () => {
        ready ??= mkdir(path.dirname(path.resolve(options.file)), { recursive: true });
        await ready;
        await appendFile(options.file, JSON.stringify(record) + '\n');
      };
      try {
        const response = await inner(input, init);
        record.ms = Date.now() - started;
        record.status = response.status;
        record.request_id = [...response.headers].find(([k]) => /request-id/i.test(k))?.[1];
        const text = await response.clone().text();
        try {
          record.response = JSON.parse(text);
        } catch {
          record.error = text.slice(0, 500);
        }
        if (!response.ok) record.error ??= `HTTP ${response.status}`;
        await write();
        return response;
      } catch (error) {
        record.ms = Date.now() - started;
        record.error = (error as Error).message;
        await write();
        throw error;
      }
    }) as Fetch;

  return Object.assign(call({}), { with: (extra: Extra) => call(extra) });
}
