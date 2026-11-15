/**
 * A small Markdown renderer for the guides under docs/: headings, paragraphs, lists, tables, fenced code,
 * inline code, bold, italics and links. It builds React elements, never HTML strings, so text is always
 * escaped. It covers what the guides use, not all of CommonMark.
 */
import type { ReactNode } from 'react';

/** How a link in the text is rendered: where it goes, and whether it opens in a new tab. */
export type LinkResolver = (href: string) => { href: string; external?: boolean } | undefined;

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

/** Plain text of inline Markdown, for heading ids and the outline. */
export function plainText(md: string): string {
  return md.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '');
}

export type Block =
  | { kind: 'heading'; level: number; text: string; id: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'code'; lang: string; text: string };

const fence = /^\s*(```+|~~~+)\s*([\w-]*)\s*$/;
const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const listItem = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const tableSep = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  // Split on pipes that are not escaped and not inside inline code.
  const out: string[] = [];
  let cur = '';
  let code = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      code = !code;
      cur += ch;
    } else if (ch === '|' && !code) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parse(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  const ids = new Map<string, number>();
  let i = 0;
  const startsBlock = (l: string) => fence.test(l) || heading.test(l) || listItem.test(l) || l.trim().startsWith('|');
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const f = line.match(fence);
    if (f) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i].trim().startsWith(f[1]) && fence.test(lines[i]))) body.push(lines[i++]);
      i++;
      blocks.push({ kind: 'code', lang: f[2], text: body.join('\n') });
      continue;
    }
    const h = line.match(heading);
    if (h) {
      const base = slugify(plainText(h[2])) || 'section';
      const n = ids.get(base) ?? 0;
      ids.set(base, n + 1);
      blocks.push({ kind: 'heading', level: h[1].length, text: h[2], id: n ? `${base}-${n}` : base });
      i++;
      continue;
    }
    if (line.trim().startsWith('|') && i + 1 < lines.length && tableSep.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      blocks.push({ kind: 'table', head, rows });
      continue;
    }
    const li = line.match(listItem);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(listItem);
        if (m && /\d/.test(m[1]) === ordered) {
          items.push(m[2]);
          i++;
        } else if (lines[i].trim() && /^\s+/.test(lines[i]) && items.length) {
          // A continuation line, indented under the item.
          items[items.length - 1] += ` ${lines[i].trim()}`;
          i++;
        } else break;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i]))) para.push(lines[i++].trim());
    blocks.push({ kind: 'paragraph', text: para.join(' ') });
  }
  return blocks;
}

const inlinePattern = /(`+)([\s\S]*?[^`])\1(?!`)|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;

export function inline(text: string, resolve: LinkResolver, key = ''): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(inlinePattern)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}.${n++}`;
    if (m[1]) out.push(<code key={k}>{m[2].trim()}</code>);
    else if (m[3] !== undefined) {
      const target = resolve(m[4]);
      const children = inline(m[3], resolve, k);
      out.push(
        target ? (
          <a key={k} href={target.href} {...(target.external ? { target: '_blank', rel: 'noreferrer' } : {})}>
            {children}
          </a>
        ) : (
          <span key={k}>{children}</span>
        ),
      );
    } else if (m[5] !== undefined) out.push(<strong key={k}>{inline(m[5], resolve, k)}</strong>);
    else if (m[6] !== undefined) out.push(<em key={k}>{inline(m[6], resolve, k)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ blocks, resolve }: { blocks: Block[]; resolve: LinkResolver }) {
  return (
    <>
      {blocks.map((b, i) => {
        const k = String(i);
        switch (b.kind) {
          case 'heading': {
            const H = `h${Math.min(b.level, 4)}` as 'h1' | 'h2' | 'h3' | 'h4';
            return (
              <H key={k} id={b.id}>
                {inline(b.text, resolve, k)}
              </H>
            );
          }
          case 'paragraph':
            return <p key={k}>{inline(b.text, resolve, k)}</p>;
          case 'list': {
            const L = b.ordered ? 'ol' : 'ul';
            return (
              <L key={k}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, resolve, `${k}.${j}`)}</li>
                ))}
              </L>
            );
          }
          case 'table':
            return (
              <div key={k} className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j}>{inline(c, resolve, `${k}.h${j}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, j) => (
                      <tr key={j}>
                        {r.map((c, x) => (
                          <td key={x}>{inline(c, resolve, `${k}.${j}.${x}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'code':
            return (
              <pre key={k} data-lang={b.lang || undefined}>
                <code>{b.text}</code>
              </pre>
            );
        }
      })}
    </>
  );
}
