import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkAssociation } from '../src/verify/association';
import { checkBatch } from '../src/aiwork/check';
import type { TaskRecord } from '../src/aiwork/record';

const TWO_INVOICES = `Invoice INV-2026-0401 for Fernweh Supply Ltd
Issued 2026-08-01, due 2026-09-01
Subtotal £400.00
Total due £480.00

Invoice INV-2026-0402 for Fernweh Supply Ltd
Issued 2026-08-15, due 2026-10-15
Subtotal £900.00
Total due £1080.00`;

describe('facts the source pairs differently', () => {
  test('an amount from one invoice with the due date of another is caught', () => {
    const r = checkAssociation('Your balance of £480.00 is due on 2026-10-15.', [TWO_INVOICES]);
    assert.equal(r.length, 1);
    assert.match(r[0]!.summary, /£480\.00/);
    assert.match(r[0]!.summary, /2026-10-15/);
  });

  test('the correct pairing says nothing', () => {
    const r = checkAssociation('Your balance of £480.00 is due on 2026-09-01.', [TWO_INVOICES]);
    assert.deepEqual(r, []);
  });

  test('a single-record source is left alone entirely', () => {
    const one = 'Invoice INV-1. Issued 2026-08-01, due 2026-09-01. Total due £480.00.';
    const r = checkAssociation('Your balance of £480.00 is due on 2026-12-31.', [one]);
    assert.deepEqual(r, []);
  });

  test('a date that is nowhere in the source is a grounding matter, not this one', () => {
    const r = checkAssociation('Your balance of £480.00 is due on 2027-01-01.', [TWO_INVOICES]);
    assert.deepEqual(r, []);
  });
});

describe('wired into checkBatch', () => {
  test('a misattributed answer is flagged as a problem', () => {
    const records: TaskRecord[] = [
      { id: 't1', input: 'what do I owe', sources: [TWO_INVOICES], output: 'Your balance of £480.00 is due on 2026-10-15.' },
    ];
    const { results } = checkBatch(records);
    assert.ok(results[0]!.problems.some((p) => p.kind === 'misattributed'));
  });
});
