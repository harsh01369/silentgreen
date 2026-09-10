import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkDistribution, type TaskSignal } from '../src/verify/distribution';
import { checkBatch } from '../src/aiwork/check';
import type { TaskRecord } from '../src/aiwork/record';

function sig(over: Partial<TaskSignal> & { id: string }): TaskSignal {
  return {
    output: 'A perfectly ordinary answer of a fairly typical length for this batch.',
    deferred: false,
    refused: false,
    empty: false,
    atomsChecked: 3,
    grounded: true,
    ...over,
  };
}

const kinds = (ts: TaskSignal[]) => checkDistribution(ts).map((s) => s.kind).sort();

describe('what the batch looks like as a whole', () => {
  test('a batch that defers a quarter of its tasks', () => {
    const ts = Array.from({ length: 20 }, (_, i) => sig({ id: `t${i}`, deferred: i < 6 }));
    assert.ok(kinds(ts).includes('deferral-rate'));
  });

  test('a batch of mostly refusals', () => {
    const ts = Array.from({ length: 20 }, (_, i) => sig({ id: `t${i}`, refused: i < 6 }));
    assert.ok(kinds(ts).includes('refusal-rate'));
  });

  test('a batch where a fifth of the answers are empty', () => {
    const ts = Array.from({ length: 20 }, (_, i) => sig({ id: `t${i}`, empty: i < 4, output: i < 4 ? '' : sig({ id: 'x' }).output }));
    assert.ok(kinds(ts).includes('empty-rate'));
  });

  test('a batch collapsed onto one canned reply', () => {
    const ts = Array.from({ length: 20 }, (_, i) => sig({ id: `t${i}`, output: i < 10 ? 'Please check the portal for details.' : `unique answer number ${i} with its own words` }));
    assert.ok(kinds(ts).includes('collapse'));
  });

  test('a batch where almost nothing carries a checkable fact', () => {
    const ts = Array.from({ length: 20 }, (_, i) => sig({ id: `t${i}`, atomsChecked: i < 2 ? 2 : 0 }));
    assert.ok(kinds(ts).includes('atom-drought'));
  });

  test('one answer far longer than its neighbours', () => {
    const ts = Array.from({ length: 20 }, (_, i) => sig({ id: `t${i}`, output: i === 4 ? 'x'.repeat(6000) : 'short and tidy answer here' }));
    assert.ok(kinds(ts).includes('length-outlier'));
  });
});

describe('not crying wolf', () => {
  test('a small batch says nothing about rates', () => {
    const ts = Array.from({ length: 5 }, (_, i) => sig({ id: `t${i}`, deferred: true }));
    assert.deepEqual(checkDistribution(ts), []);
  });

  test('an ordinary healthy batch is quiet', () => {
    const ts = Array.from({ length: 20 }, (_, i) => sig({ id: `t${i}`, output: `answer ${i}: the balance is 4${i}0 pounds and it is due next month` }));
    assert.deepEqual(checkDistribution(ts), []);
  });

  test('one deferral in a large batch is not a rate', () => {
    const ts = Array.from({ length: 20 }, (_, i) =>
      sig({ id: `t${i}`, deferred: i === 0, output: `answer ${i}: the balance is 4${i}0 pounds and it is due next month` }),
    );
    assert.deepEqual(checkDistribution(ts), []);
  });
});

describe('wired into checkBatch', () => {
  test('the demo-shaped batch surfaces the collapse and deferral signals', () => {
    const records: TaskRecord[] = Array.from({ length: 18 }, (_, i) => ({
      id: `task-${i}`,
      input: 'what do I owe',
      sources: ['Balance 100.00 GBP, due 2026-09-30.'],
      output:
        i >= 12
          ? 'Please contact our support team and they will help you.'
          : 'Your balance is 100.00 GBP, due on 2026-09-30.',
    }));
    const { summary } = checkBatch(records);
    assert.ok(Array.isArray(summary.signals));
    assert.ok(summary.signals.some((s) => s.kind === 'deferral-rate' || s.kind === 'collapse'));
  });
});
