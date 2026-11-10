import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answersOf, isDecisionRecord, isLabelLine, labelKey, readAnswer, toRows, type DecisionRecord } from '../src/format.ts';

test('readAnswer reads the wire shapes', () => {
  assert.deepEqual(readAnswer({ type: 'noul', noul: 0.2 }), { type: 'noul', p: 0.2 });
  assert.deepEqual(readAnswer({ choice: 'a', confidence: 0.9, probabilities: { a: 0.9, b: 0.1 } }), {
    type: 'choice',
    choice: 'a',
    confidence: 0.9,
    probabilities: { a: 0.9, b: 0.1 },
  });
  // Confidence falls back to the chosen option's probability.
  assert.equal((readAnswer({ type: 'choice', choice: 'b', probabilities: { a: 0.3, b: 0.7 } }) as { confidence: number }).confidence, 0.7);
  assert.deepEqual(readAnswer({ type: 'score', score: 3 }), { type: 'score', value: 3, probabilities: undefined });
  assert.equal(readAnswer({ type: 'noul' }), undefined);
  assert.equal(readAnswer('x'), undefined);
});

test('answersOf prefers normalized answers, else reads the response', () => {
  const fromResponse: DecisionRecord = { run: 'r', response: { answers: { q: { type: 'noul', noul: 0.4 }, bad: 1 } } };
  assert.deepEqual(answersOf(fromResponse), { q: { type: 'noul', p: 0.4 } });
  const normalized: DecisionRecord = { run: 'r', answers: { q: { type: 'noul', p: 0.1 } }, response: { answers: { q: { noul: 0.9 } } } };
  assert.equal((answersOf(normalized).q as { p: number }).p, 0.1);
});

test('record and label line detection', () => {
  assert.ok(isDecisionRecord({ run: 'r', response: {} }));
  assert.ok(!isDecisionRecord({ run: 'r' }));
  assert.ok(isLabelLine({ item: 'i', question: 'q', expected: true }));
  assert.ok(!isLabelLine({ item: 'i', question: 'q', expected: true, run: 'r' }));
});

test('toRows joins labels; record labels win', () => {
  const records: DecisionRecord[] = [
    {
      id: 'a',
      run: 'r1',
      item: 'case-1',
      response: { model: 'm-1.0', answers: { ok: { type: 'noul', noul: 0.8 }, team: { choice: 'x', confidence: 0.6 } } },
      thresholds: { ok: 0.5 },
      labels: { team: 'y' },
    },
  ];
  const labels = new Map([
    [labelKey('case-1', 'ok'), 'no' as const],
    [labelKey('case-1', 'team'), 'x' as const],
  ]);
  const [ok, team] = toRows(records, labels);
  assert.equal(ok.p, 0.8);
  assert.equal(ok.y, false);
  assert.equal(ok.threshold, 0.5);
  assert.equal(ok.model, 'm-1.0');
  assert.equal(team.p, 0.6);
  assert.equal(team.expected, 'y');
  assert.equal(team.y, false);
});
