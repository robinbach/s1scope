/**
 * The Document page: the guides under docs/, bundled into the page at build time and rendered here,
 * so they work offline like the rest of the viewer.
 */
import { useEffect, useMemo, type MouseEvent } from 'react';
import { Markdown, parse, plainText, type LinkResolver } from './markdown.tsx';
import { docHref, docRoute } from './nav.ts';

/** docs/*.md, as text, keyed by file name without the extension. */
const sources: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob('../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>).map(
    ([file, text]) => [file.replace(/^.*\//, '').replace(/\.md$/, ''), text],
  ),
);

/** Where repository files that are not guides can be read. */
const repo = 'https://github.com/robinbach/s1scope/blob/main/';

interface Guide {
  /** File name under docs/, without .md. */
  id: string;
  title: string;
  summary: string;
  topics: string[];
}

/** The guides in reading order. A guide whose file is not in docs/ yet is listed as planned. */
const guides: Guide[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    summary: 'Install, generate the demo data, and open the viewer on your own logs.',
    topics: ['npm install and build', 's1scope view <folder>', 'development mode with S1SCOPE_DATA'],
  },
  {
    id: 'format',
    title: 'Logging calls',
    summary: 'The JSONL log format: decision records, label lines, and recording calls from Node.',
    topics: ['decision records', 'answer shapes', 'label lines', 'recordingFetch'],
  },
  {
    id: 'dashboard',
    title: 'Reading the dashboard',
    summary: 'What each chart and number means, and how to pick a threshold with them.',
    topics: [
      'questions, filters and pooling',
      'false accepts and false rejects',
      'precision, recall, Brier score, ECE',
      'reliability curve and threshold sweep',
      'splits and question versions',
    ],
  },
  {
    id: 'compare',
    title: 'Comparing runs',
    summary: 'Line up two runs, models or versions sample by sample.',
    topics: ['choosing A and B', 'worse and better lists', 'p in A against p in B'],
  },
  {
    id: 'reference',
    title: 'Links and CLI',
    summary: 'Every link parameter and command-line option, and how the index file works.',
    topics: ['link parameters (#q=…&t=…)', 'view options: --port, --db, --memory', 'the DuckDB index and refresh'],
  },
  {
    id: 'api',
    title: 'HTTP API',
    summary: 'The data API the page uses, for scripts and other front ends.',
    topics: ['GET /api/overview', 'POST /api/rows', 'GET /api/record', 'the Store interface'],
  },
];

const ready = (g: Guide) => g.id in sources;

export function Docs({ hash, navigate }: { hash: string; navigate: (href: string) => void }) {
  const { guide: id, section } = docRoute(hash);
  const guide = guides.find((g) => g.id === id);

  // Links inside this page change the address without a reload, as a new history entry.
  const onClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!a || !href?.startsWith('#') || a.target || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  };

  return (
    <div className="layout docs" onClick={onClick}>
      <aside className="docs-toc">
        <section>
          <h2>
            <a href={docHref()} className={id ? undefined : 'current'}>
              Guides
            </a>
          </h2>
          <nav>
            {guides.map((g) =>
              ready(g) ? (
                <a key={g.id} href={docHref(g.id)} className={g.id === id ? 'current' : undefined} aria-current={g.id === id ? 'page' : undefined}>
                  {g.title}
                </a>
              ) : (
                <span key={g.id} className="planned" title="Not written yet">
                  {g.title}
                  <span className="badge">planned</span>
                </span>
              ),
            )}
          </nav>
        </section>
        {guide && ready(guide) && <Outline id={guide.id} section={section} />}
      </aside>
      <main>{guide && ready(guide) ? <Article id={guide.id} section={section} /> : <Index missing={id} />}</main>
    </div>
  );
}

function Index({ missing }: { missing?: string }) {
  useEffect(() => {
    document.title = 's1scope · Document';
  }, []);
  return (
    <div className="docs-body">
      <h2>Document</h2>
      {missing !== undefined && <p className="linknote">There is no guide called “{missing}” yet.</p>}
      <p className="docs-lead">
        Guides to s1scope. They are kept as Markdown under <code>docs/</code> in the repository and shown here as
        they were when the viewer was built.
      </p>
      <ol className="guides">
        {guides.map((g) => (
          <li key={g.id} className={ready(g) ? 'guide' : 'guide planned'}>
            <div className="guide-head">
              <h3>{ready(g) ? <a href={docHref(g.id)}>{g.title}</a> : g.title}</h3>
              {!ready(g) && <span className="badge">planned</span>}
            </div>
            <p>{g.summary}</p>
            <ul className="muted">
              {g.topics.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Turns links between guides into page addresses; other repository files go to GitHub. */
const resolve =
  (from: string): LinkResolver =>
  (href) => {
    if (/^[a-z]+:/i.test(href)) return { href, external: true };
    const [file, anchor] = href.split('#');
    if (!file) return { href: docHref(from, anchor) };
    const m = file.match(/^(?:\.\/|docs\/)?([\w-]+)\.md$/);
    if (m && m[1] in sources) return { href: docHref(m[1], anchor) };
    const path = file.replace(/^\.\//, '');
    return { href: repo + (path.startsWith('../') ? path.slice(3) : `docs/${path}`) + (anchor ? `#${anchor}` : ''), external: true };
  };

function Article({ id, section }: { id: string; section?: string }) {
  const blocks = useMemo(() => parse(sources[id]), [id]);
  const title = blocks.find((b) => b.kind === 'heading' && b.level === 1);

  useEffect(() => {
    document.title = `s1scope · ${title?.kind === 'heading' ? plainText(title.text) : id}`;
  }, [id, title]);

  // Scroll to the section the address names, or to the top for a new guide.
  useEffect(() => {
    const el = section ? document.getElementById(section) : undefined;
    if (el) el.scrollIntoView({ block: 'start' });
    else scrollTo(0, 0);
  }, [id, section]);

  return (
    <article className="prose">
      <Markdown blocks={blocks} resolve={resolve(id)} />
    </article>
  );
}

/** The guide's sections, linked. */
function Outline({ id, section }: { id: string; section?: string }) {
  const headings = useMemo(() => parse(sources[id]).filter((b) => b.kind === 'heading' && b.level === 2), [id]);
  if (headings.length < 2) return null;
  return (
    <section className="outline">
      <h2>On this page</h2>
      <nav>
        {headings.map(
          (h) =>
            h.kind === 'heading' && (
              <a key={h.id} href={docHref(id, h.id)} className={h.id === section ? 'current' : undefined}>
                {plainText(h.text)}
              </a>
            ),
        )}
      </nav>
    </section>
  );
}
