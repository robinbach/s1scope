import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { parse, slugify } from '../web/markdown.tsx';
import { docHref, docRoute, pageOf } from '../web/nav.ts';

test('parses the block kinds the guides use', () => {
  const blocks = parse(
    [
      '# Title',
      '',
      'One **bold** line',
      'continued.',
      '',
      '- a',
      '- b',
      '  more b',
      '1. first',
      '',
      '| x | `a|b` |',
      '| --- | --- |',
      '| 1 | 2 |',
      '',
      '```sh',
      'npm run dev',
      '',
      '# not a heading',
      '```',
      '## Title',
    ].join('\r\n'),
  );
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['heading', 'paragraph', 'list', 'list', 'table', 'code', 'heading'],
  );
  assert.deepEqual(blocks[1], { kind: 'paragraph', text: 'One **bold** line continued.' });
  assert.deepEqual(blocks[2], { kind: 'list', ordered: false, items: ['a', 'b more b'] });
  assert.deepEqual(blocks[4], { kind: 'table', head: ['x', '`a|b`'], rows: [['1', '2']] });
  assert.deepEqual(blocks[5], { kind: 'code', lang: 'sh', text: 'npm run dev\n\n# not a heading' });
  // Repeated headings get distinct ids.
  assert.equal(blocks[0].kind === 'heading' && blocks[0].id, 'title');
  assert.equal(blocks[6].kind === 'heading' && blocks[6].id, 'title-1');
});

test('slugs', () => {
  assert.equal(slugify('Links and CLI'), 'links-and-cli');
  assert.equal(slugify('`p` and the *threshold*'), 'p-and-the-threshold');
});

test('every guide in docs/ parses, and its tables are rectangular', () => {
  for (const file of readdirSync('docs').filter((f) => f.endsWith('.md'))) {
    for (const b of parse(readFileSync(`docs/${file}`, 'utf8')))
      if (b.kind === 'table') for (const r of b.rows) assert.equal(r.length, b.head.length, `${file}: ${r.join(' | ')}`);
  }
});

test('docs addresses', () => {
  assert.equal(pageOf('#docs'), 'docs');
  assert.equal(pageOf('#docs/dashboard/tiles'), 'docs');
  assert.equal(pageOf('#q=docs'), 'dashboard');
  assert.equal(pageOf(''), 'dashboard');
  assert.deepEqual(docRoute('#docs/dashboard/tiles'), { guide: 'dashboard', section: 'tiles' });
  assert.deepEqual(docRoute('#docs'), { guide: undefined, section: undefined });
  assert.equal(docHref('reference', 'link-parameters'), '#docs/reference/link-parameters');
});

test('every "?" link in the page points to a guide section that exists', () => {
  const ids = (guide: string) =>
    new Set(parse(readFileSync(`docs/${guide}.md`, 'utf8')).flatMap((b) => (b.kind === 'heading' ? [b.id] : [])));
  for (const file of readdirSync('web').filter((f) => f.endsWith('.tsx'))) {
    const text = readFileSync(`web/${file}`, 'utf8');
    for (const m of text.matchAll(/<Help guide="([\w-]+)"(?: section="([\w-]+)")? \/>/g))
      if (m[2]) assert.ok(ids(m[1]).has(m[2]), `${file}: ${m[1]}#${m[2]}`);
  }
});
