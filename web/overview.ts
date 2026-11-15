import type { Overview } from '../src/api.ts';

let pending: Promise<Overview> | undefined;

/**
 * The overview, fetched once per page load and shared by the top bar and the dashboard.
 * The server picks up new log files when it is asked, so a reload is how new logs show up.
 */
export function loadOverview(): Promise<Overview> {
  pending ??= fetch('/api/overview')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch((e) => {
      // Let the next caller try again.
      pending = undefined;
      throw e;
    });
  return pending;
}
