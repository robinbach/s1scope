/**
 * Pages of the viewer. The dashboard keeps its view in the address after `#` (see url.ts). The docs live
 * under `#docs`: `#docs` is the list of guides, `#docs/<guide>` one guide, `#docs/<guide>/<heading>` a
 * section of it. The dashboard's view parameters never produce an address starting with `docs`.
 */
export type Page = 'dashboard' | 'docs';

export const pages: { page: Page; label: string }[] = [
  { page: 'dashboard', label: 'Dashboard' },
  { page: 'docs', label: 'Document' },
];

export const docsHash = 'docs';

export function pageOf(hash: string): Page {
  const h = hash.replace(/^#/, '');
  return h === docsHash || h.startsWith(`${docsHash}/`) ? 'docs' : 'dashboard';
}

/** The guide and section an address under `#docs` points to. */
export function docRoute(hash: string): { guide?: string; section?: string } {
  const [, guide, ...rest] = hash.replace(/^#/, '').split('/');
  return { guide: guide ? decodeURIComponent(guide) : undefined, section: rest.length ? decodeURIComponent(rest.join('/')) : undefined };
}

export const docHref = (guide?: string, section?: string) =>
  `#${docsHash}${guide ? `/${encodeURIComponent(guide)}` : ''}${section ? `/${encodeURIComponent(section)}` : ''}`;
