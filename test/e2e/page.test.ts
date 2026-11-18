/**
 * Page tests: the built page (dist/web) in a real browser, against the real server on a small fixed log.
 * They cover what the unit tests cannot: that the page's parts work together after a change.
 *
 *   npm run test:e2e          builds the page first; needs a browser: npx playwright install chromium
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { handler } from '../../src/server.ts';
import { MemoryStore } from '../../src/store.ts';

const webRoot = path.resolve('dist/web');
const TEAMS = ['billing', 'infra'];
const ITEMS = 40;

/**
 * Two runs with one model each, answering the same 40 items: a yes/no question and a choice question.
 * Every item has `lang`; all but the last have `variant`, so filters meet a missing tag too.
 */
function fixture(): string[] {
  const lines: string[] = [];
  for (const [run, model, shift] of [
    ['e2e base', 'm-small', 0],
    ['e2e next', 'm-large', 0.1],
  ] as const)
    for (let i = 0; i < ITEMS; i++) {
      const urgent = i % 3 === 0;
      const team = TEAMS[i % 2];
      const p = Math.min(0.95, (urgent ? 0.7 : 0.2) + ((i * 7) % 10) / 40 + shift);
      const choice = i % 5 === 0 ? TEAMS[(i + 1) % 2] : team;
      lines.push(
        JSON.stringify({
          v: 0,
          id: `${run}/item-${i}`,
          run,
          item: `item-${i}`,
          model,
          answers: {
            urgent: { type: 'noul', p: Math.round(p * 100) / 100 },
            team: { type: 'choice', choice, confidence: 0.6 + (i % 4) / 10 },
          },
          labels: { urgent, team },
          tags: { lang: i % 4 === 0 ? 'de' : 'en', ...(i < ITEMS - 1 ? { variant: i % 2 ? 'v1' : 'v0' } : {}) },
        }),
      );
    }
  return lines;
}

let dir: string;
let server: Server;
let base: string;
let browser: Browser;
let page: Page;
let problems: string[];

before(async () => {
  if (!existsSync(path.join(webRoot, 'index.html'))) throw new Error('dist/web is missing: run npm run build (npm run test:e2e does)');
  dir = await mkdtemp(path.join(tmpdir(), 's1scope-e2e-'));
  await writeFile(path.join(dir, 'calls.jsonl'), fixture().join('\n') + '\n');
  const handle = handler(await MemoryStore.open([dir]), webRoot);
  server = createServer(async (req, res) => {
    if (!(await handle(req, res))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1300, height: 850 } });
  page.setDefaultTimeout(10_000);
  // Any script error or failed request on the page fails the test.
  problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
});

afterEach(async () => {
  await page.close();
  assert.deepEqual(problems, []);
});

const open = (hash = '') => page.goto(`${base}${hash ? `#${hash}` : ''}`);
const header = () => page.locator('.viewhead .muted').first();
const answers = async () => Number((await header().innerText()).match(/(\d+) answers/)?.[1]);
/** Waits until the question header shows `n` answers. */
const expectAnswers = (n: number) => page.locator('.viewhead', { hasText: `· ${n} answers ·` }).waitFor();
const hash = () => page.evaluate(() => decodeURIComponent(location.hash));

test('picking a question shows its answers and tiles', async () => {
  await open();
  await page.locator('.q', { hasText: 'urgent' }).click();
  await expectAnswers(2 * ITEMS);
  assert.ok((await page.locator('.tile').count()) >= 4);
  assert.match(await hash(), /q=urgent/);
});

test('sidebar filters narrow the answers, count values after the other filters, and survive a reload', async () => {
  await open('q=urgent');
  await expectAnswers(2 * ITEMS);
  const add = page.locator('.tags select');
  const options = await add.locator('option').allInnerTexts();
  for (const f of ['model', 'tag:lang', 'tag:variant']) assert.ok(options.includes(f), `${f} in ${options}`);

  await add.selectOption('model');
  const model = page.locator('.taggroup', { hasText: 'model' });
  await model.locator('label', { hasText: 'm-large' }).locator('input').uncheck();
  await expectAnswers(ITEMS);

  await add.selectOption('tag:variant');
  const variant = page.locator('.taggroup', { hasText: 'tag:variant' });
  // The last item has no variant tag: it shows as (none), counted within m-small only.
  assert.equal(await variant.locator('label', { hasText: '(none)' }).locator('.num').innerText(), '1');
  await variant.locator('label', { hasText: 'v1' }).locator('input').uncheck();
  await variant.locator('label', { hasText: '(none)' }).locator('input').uncheck();
  await expectAnswers(ITEMS / 2);
  assert.match(await hash(), /filter=model=m-small&filter=tag:variant=v0/);

  await page.reload();
  await expectAnswers(ITEMS / 2);
  await variant.locator('.remove').click();
  await expectAnswers(ITEMS);
  assert.doesNotMatch(await hash(), /variant/);
});

test('compare by stays available when the filters leave one value', async () => {
  await open('q=team&view=compare&by=model&filter=model=m-small');
  await page.locator('.note', { hasText: 'Only one model here' }).waitFor();
  const by = page.locator('.controls label', { hasText: 'Compare by' }).locator('select');
  await by.selectOption('tag:lang');
  await page.locator('.controls .side', { hasText: 'A' }).waitFor();
  assert.equal(await page.locator('.note', { hasText: 'Only one' }).count(), 0);
});

test('compare lines up the two runs', async () => {
  await open('q=urgent&view=compare&by=model&a=m-small&b=m-large');
  await page.locator('.note', { hasText: `${ITEMS} samples in both` }).waitFor();
});

test('a call opens in the side panel and its close button works', async () => {
  await open('q=urgent&tab=all');
  await expectAnswers(2 * ITEMS);
  await page.locator('.cases tbody tr').first().click();
  const panel = page.locator('.panel[role=dialog]');
  await panel.waitFor();
  assert.match(await hash(), /open=/);
  // A click fails if anything (such as the sticky top bar) covers the button.
  await panel.locator('.close').click();
  await panel.waitFor({ state: 'detached' });
  assert.doesNotMatch(await hash(), /open=/);
});

test('the top bar switches to the guides and back', async () => {
  await open('q=urgent');
  await expectAnswers(2 * ITEMS);
  await page.locator('.topnav a', { hasText: 'Document' }).click();
  await page.locator('.docs-body').waitFor();
  await page.locator('.docs-toc a', { hasText: /dashboard/i }).first().click();
  await page.getByRole('heading', { name: 'Picking what to look at' }).waitFor();
  assert.match(await hash(), /^#docs\/dashboard/);
  await page.locator('.topnav a', { hasText: 'Dashboard' }).click();
  await expectAnswers(2 * ITEMS);
  assert.ok((await answers()) > 0);
});
