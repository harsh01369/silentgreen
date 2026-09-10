import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inspectTask } from '../src/verify/inspect';
import type { TaskRecord } from '../src/aiwork/record';

const INVOICE =
  'Invoice INV-2026-0412 for Fernweh Supply Ltd. Issued 2026-08-14, due 2026-09-13. Subtotal £571.00. VAT £114.20. Total due £685.20.';

function task(output: string, sources = [INVOICE]): TaskRecord {
  return { id: 't', input: 'what do I owe', sources, output };
}

describe('laying a task out side by side', () => {
  test('a fabricated figure is an ungrounded segment with a reason', () => {
    const insp = inspectTask(task('Your balance is £742.60, due 2026-09-13.'));
    const bad = insp.segments.filter((s) => s.kind === 'ungrounded');
    assert.equal(bad.length, 1);
    assert.equal(bad[0]!.text, '£742.60');
    assert.match(bad[0]!.why!, /nowhere/);
  });

  test('a figure that is in the source is a grounded segment', () => {
    const insp = inspectTask(task('Your total is £685.20.'));
    assert.ok(insp.segments.some((s) => s.kind === 'grounded' && s.text === '£685.20'));
    assert.equal(insp.counts.ungrounded, 0);
  });

  test('the segments reassemble into the original answer exactly', () => {
    const answer = 'Balance £742.60, VAT £123.77, due 2026-09-30. Contact finance@fernweh.example.';
    const insp = inspectTask(task(answer));
    assert.equal(insp.segments.map((s) => s.text).join(''), answer);
  });

  test('grounded atoms are located in the source for highlighting', () => {
    const insp = inspectTask(task('Your total is £685.20, due 2026-09-13.'));
    const texts = insp.sourceHighlights.map((h) => h.text);
    assert.ok(texts.includes('£685.20'));
    assert.ok(texts.includes('2026-09-13'));
    for (const h of insp.sourceHighlights) {
      assert.equal(insp.source.slice(h.start, h.end), h.text);
    }
  });

  test('a quotation is reported whole, not chopped into inline marks', () => {
    const src = 'Our policy: returns are accepted within 30 days of delivery.';
    const insp = inspectTask(task('The policy says "returns are accepted within 60 days of delivery".', [src]));
    assert.equal(insp.quotes.length, 1);
    assert.equal(insp.quotes[0]!.grounded, false);
    // and "60" is still marked inline as ungrounded
    assert.ok(insp.segments.some((s) => s.kind === 'ungrounded' && s.text === '60'));
  });

  test('no source is reported as a gap, not a wall of red', () => {
    const insp = inspectTask({ id: 't', input: '', sources: [], output: 'Your balance is £742.60.' });
    assert.equal(insp.basis, 'none');
    assert.equal(insp.inconclusive, true);
    assert.equal(insp.segments.filter((s) => s.kind === 'ungrounded').length, 0);
  });
});
