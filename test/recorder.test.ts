import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { createRecorder } from '../src/record/recorder';

describe('recording work as it happens', () => {
  test('the body return value is captured as the output and passed straight through', async () => {
    const sg = createRecorder();
    const answer = await sg.task({ input: 'what do I owe' }, async (t) => {
      t.source('Balance 100.00 GBP, due 2026-09-30.');
      return 'You owe 100.00 GBP, due on 2026-09-30.';
    });
    assert.equal(answer, 'You owe 100.00 GBP, due on 2026-09-30.');
    const [rec] = sg.pending();
    assert.equal(rec!.input, 'what do I owe');
    assert.deepEqual(rec!.sources, ['Balance 100.00 GBP, due 2026-09-30.']);
    assert.equal(rec!.output, 'You owe 100.00 GBP, due on 2026-09-30.');
  });

  test('actions are recorded and survive to the check', async () => {
    const sg = createRecorder();
    await sg.task({ input: 'send the invoice' }, async (t) => {
      t.source('Invoice INV-1 for Acme.');
      t.action({ kind: 'email.sent', target: 'ops@acme.example', result: 'ok' });
      return 'I have emailed the invoice to ops@acme.example.';
    });
    const [rec] = sg.pending();
    assert.equal(rec!.actions?.[0]?.kind, 'email.sent');
    assert.equal(rec!.actions?.[0]?.target, 'ops@acme.example');
  });

  test('check() runs the engine over the buffer and catches a fabrication', async () => {
    const sg = createRecorder();
    await sg.task({ input: 'what do I owe' }, async (t) => {
      t.source('Subtotal 100.00 GBP. Total due 120.00 GBP.');
      return 'Your balance is 999.00 GBP.';
    });
    const { summary } = sg.check();
    assert.equal(summary.problematic, 1);
  });

  test('a function sink receives the batch and the buffer clears', async () => {
    const seen: unknown[][] = [];
    const sg = createRecorder({ sink: (records) => void seen.push([...records]) });
    await sg.task({ input: 'a' }, async () => 'answer a');
    await sg.task({ input: 'b' }, async () => 'answer b');
    const n = await sg.flush();
    assert.equal(n, 2);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.length, 2);
    assert.equal(sg.pending().length, 0);
  });

  test('a file sink appends newline-delimited JSON', async () => {
    const path = `sg-recorder-test-${Date.now()}.jsonl`;
    try {
      const sg = createRecorder({ sink: path });
      await sg.task({ id: 't1', input: 'a' }, async () => 'answer a');
      await sg.flush();
      const lines = readFileSync(path, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);
      assert.equal(JSON.parse(lines[0]!).id, 't1');
    } finally {
      rmSync(path, { force: true });
    }
  });

  test('flushEvery flushes without an explicit call', async () => {
    const seen: number[] = [];
    const sg = createRecorder({ sink: (r) => void seen.push(r.length), flushEvery: 2 });
    await sg.task({ input: 'a' }, async () => 'a');
    await sg.task({ input: 'b' }, async () => 'b');
    // allow the fire-and-forget flush to settle
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(seen, [2]);
  });
});
