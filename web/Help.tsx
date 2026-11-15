import { docHref } from './nav.ts';

/** A small "?" that opens a guide at the section explaining what it sits next to. */
export function Help({ guide, section }: { guide: string; section?: string }) {
  return (
    <a className="help" href={docHref(guide, section)} title="How to read this" aria-label="How to read this">
      ?
    </a>
  );
}
