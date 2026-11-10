/**
 * Writes a small synthetic log to examples/demo/ so the viewer has something to show
 * without real data: two "models" answering the same 400 support tickets.
 *
 *   npx tsx scripts/make-demo.ts
 *
 * The numbers are made up. Model B is sharper but overconfident on one category.
 */
import { mkdir, writeFile } from 'node:fs/promises';

let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const clamp = (x: number) => Math.min(0.999, Math.max(0.001, x));
const noise = (s: number) => (rand() + rand() + rand() - 1.5) * s;

const teams = ['billing', 'checkout', 'infra', 'support'];
const items = Array.from({ length: 400 }, (_, i) => ({
  id: `ticket-${String(i + 1).padStart(3, '0')}`,
  urgent: rand() < 0.3,
  team: teams[Math.floor(rand() * teams.length)],
  lang: rand() < 0.7 ? 'en' : 'de',
}));

function answer(model: 'a' | 'b', item: (typeof items)[number]) {
  const sharp = model === 'a' ? 0.28 : 0.18;
  // Model B is overconfident on German tickets.
  const skew = model === 'b' && item.lang === 'de' ? 0.15 : 0;
  const pUrgent = clamp((item.urgent ? 0.78 : 0.18) + noise(sharp) + skew);
  const right = rand() < (model === 'a' ? 0.82 : 0.88);
  const choice = right ? item.team : teams[(teams.indexOf(item.team) + 1 + Math.floor(rand() * 3)) % teams.length];
  const confidence = clamp(right ? 0.75 + noise(0.3) : 0.55 + noise(0.35) + skew * 2);
  const probabilities = Object.fromEntries(teams.map((t) => [t, t === choice ? confidence : (1 - confidence) / 3]));
  return {
    model: model === 'a' ? 'demo-small-1.0' : 'demo-large-2.1',
    answers: {
      urgent: { type: 'noul', noul: Math.round(pUrgent * 100) / 100 },
      team: { type: 'choice', choice, confidence: Math.round(confidence * 100) / 100, probabilities },
    },
    usage: { input_tokens: 300 + Math.floor(rand() * 200), output_tokens: 40 },
  };
}

await mkdir('examples/demo', { recursive: true });
for (const model of ['a', 'b'] as const) {
  const run = model === 'a' ? 'demo small model' : 'demo large model';
  const lines = items.map((item, i) =>
    JSON.stringify({
      v: 0,
      id: `${run}#${i + 1}`,
      run,
      item: item.id,
      backend: 'demo',
      model: model === 'a' ? 'demo-small' : 'demo-large',
      request: {
        state: { ticket: { id: item.id, language: item.lang, summary: '(synthetic ticket text)' } },
        questions: {
          urgent: { type: 'noul', instructions: 'Is this ticket urgent?' },
          team: { type: 'choice', instructions: 'Which team should own it?', options: Object.fromEntries(teams.map((t) => [t, t])) },
        },
      },
      response: answer(model, item),
      thresholds: { urgent: 0.5, team: 0.7 },
      ms: 80 + Math.floor(rand() * 200),
      status: 200,
      tags: { lang: item.lang },
    }),
  );
  await writeFile(`examples/demo/${model === 'a' ? 'small' : 'large'}.jsonl`, lines.join('\n') + '\n');
}
const labels = items.flatMap((item) => [
  JSON.stringify({ item: item.id, question: 'urgent', expected: item.urgent }),
  JSON.stringify({ item: item.id, question: 'team', expected: item.team }),
]);
await writeFile('examples/demo/labels.jsonl', labels.join('\n') + '\n');
console.log(`wrote examples/demo/: 2 runs × ${items.length} calls, ${labels.length} labels`);
