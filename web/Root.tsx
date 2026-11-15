import { useEffect, useState } from 'react';
import type { Overview } from '../src/api.ts';
import { App } from './App.tsx';
import { Docs } from './Docs.tsx';
import { docsHash, pageOf, pages, type Page } from './nav.ts';
import { loadOverview } from './overview.ts';

/** The dashboard's address when the docs page was opened, so going back restores the same view. */
let dashboardHash = '';

const hrefOf = (page: Page) => (page === 'docs' ? `#${docsHash}` : dashboardHash ? `#${dashboardHash}` : location.pathname);

/** The top bar and the page under it. */
export function Root() {
  // The address as this component last saw it. The dashboard rewrites it with replaceState as its view
  // changes, which this does not follow; it only needs to know which page, and where in the docs.
  const [hash, setHash] = useState(() => location.hash);
  const page = pageOf(hash);
  const [overview, setOverview] = useState<Overview>();

  useEffect(() => {
    loadOverview().then(setOverview, () => {});
  }, []);

  // Back, forward, or a link pasted into this tab.
  useEffect(() => {
    const sync = () => setHash(location.hash);
    addEventListener('popstate', sync);
    addEventListener('hashchange', sync);
    return () => {
      removeEventListener('popstate', sync);
      removeEventListener('hashchange', sync);
    };
  }, []);

  useEffect(() => {
    // The docs set their own title (Docs.tsx).
    if (page === 'dashboard') document.title = 's1scope';
  }, [page]);

  /** Goes to an address in this tab, as a new history entry. */
  const navigate = (href: string) => {
    if (href === (location.hash || location.pathname)) return;
    if (page === 'dashboard') dashboardHash = location.hash.slice(1);
    history.pushState(null, '', href);
    setHash(location.hash);
  };

  const go = (to: Page) => {
    // The Document tab also leads back to the list of guides from inside one.
    if (to === page && to === 'dashboard') return;
    navigate(hrefOf(to));
    scrollTo(0, 0);
  };

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <h1>s1scope</h1>
          {overview && (
            <span className="muted">
              {overview.answers.toLocaleString()} answers
              {overview.skippedCount ? ` · ${overview.skippedCount} lines skipped` : ''}
            </span>
          )}
          <CopyLink />
        </div>
        <nav className="topnav" aria-label="Pages">
          {pages.map(({ page: p, label }) => (
            <a
              key={p}
              href={hrefOf(p)}
              className={p === page ? 'active' : undefined}
              aria-current={p === page ? 'page' : undefined}
              onClick={(e) => {
                if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                e.preventDefault();
                go(p);
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </header>
      {page === 'docs' ? <Docs hash={hash} navigate={navigate} /> : <App />}
    </>
  );
}

/** Copies the address, which always describes the current view. */
function CopyLink() {
  const [done, setDone] = useState(false);
  const copy = () => {
    if (!navigator.clipboard) return void prompt('Copy this link', location.href);
    navigator.clipboard
      .writeText(location.href)
      .then(() => {
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      })
      .catch(() => prompt('Copy this link', location.href));
  };
  return (
    <button className="link copylink" onClick={copy} title="Copy a link to exactly this view">
      {done ? 'Copied' : 'Copy link'}
    </button>
  );
}
