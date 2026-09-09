import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger, verifyChain, hashEntry, GENESIS_PREV, type LedgerEntry } from '../src/ledger/chain';

describe('the evidence ledger', () => {
  test('the first entry links to genesis', () => {
    const l = new Ledger();
    const e = l.append('workflow-observed', 'wf_1', { name: 'Invoice sync' });
    assert.equal(e.seq, 0);
    assert.equal(e.prevHash, GENESIS_PREV);
    assert.equal(l.verify().ok, true);
  });

  test('a chain of entries verifies', () => {
    const l = new Ledger();
    l.append('workflow-observed', 'wf_1', { name: 'Invoice sync' });
    l.append('proposal-made', 'wf_1', { count: 6 });
    l.append('assertion-confirmed', 'wf_1', { by: 'harsh@example.com', assertionId: 'as_1' });
    l.append('violation', 'wf_1', { assertionId: 'as_1', detail: 'produced no items' });
    assert.equal(l.length, 4);
    assert.equal(l.verify().ok, true);
  });

  test('editing an entry is detected', () => {
    const l = new Ledger();
    l.append('assertion-confirmed', 'wf_1', { by: 'harsh@example.com' });
    l.append('violation', 'wf_1', { detail: 'produced no items' });

    const tampered = [...l.all()] as LedgerEntry[];
    // Someone quietly softens a violation before sending the report on.
    tampered[1] = { ...tampered[1]!, payload: { detail: 'minor variation, no action needed' } };

    const r = verifyChain(tampered);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.brokenAt === 1);
    assert.ok(!r.ok && /edited since it was written/.test(r.reason));
  });

  test('deleting an entry is detected', () => {
    const l = new Ledger();
    l.append('workflow-observed', 'wf_1', { a: 1 });
    l.append('violation', 'wf_1', { b: 2 });
    l.append('run-verified', 'wf_1', { c: 3 });

    const withHole = [l.all()[0]!, l.all()[2]!];
    const r = verifyChain(withHole);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && /removed or reordered/.test(r.reason));
  });

  test('re-hashing a tampered entry still fails, because the link breaks downstream', () => {
    const l = new Ledger();
    l.append('violation', 'wf_1', { detail: 'produced no items' });
    l.append('run-verified', 'wf_1', { ok: true });

    const entries = [...l.all()] as LedgerEntry[];
    const edited = { ...entries[0]!, payload: { detail: 'nothing to see' } };
    // A careful tamperer recomputes the hash of the entry they changed.
    entries[0] = { ...edited, hash: hashEntry(edited) };

    const r = verifyChain(entries);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.brokenAt === 1, 'the next entry no longer links to it');
  });

  test('payload key order does not affect the hash', () => {
    const a = hashEntry({ seq: 0, at: 'T', kind: 'note', workflowId: 'w', prevHash: GENESIS_PREV, payload: { x: 1, y: { b: 2, a: 1 } } });
    const b = hashEntry({ seq: 0, at: 'T', kind: 'note', workflowId: 'w', prevHash: GENESIS_PREV, payload: { y: { a: 1, b: 2 }, x: 1 } });
    assert.equal(a, b);
  });

  test('entries can be filtered by client and period for a report', () => {
    const l = new Ledger();
    l.append('violation', 'wf_1', { n: 1 }, { clientId: 'acme', at: '2026-08-05T00:00:00.000Z' });
    l.append('violation', 'wf_2', { n: 2 }, { clientId: 'globex', at: '2026-08-06T00:00:00.000Z' });
    l.append('violation', 'wf_1', { n: 3 }, { clientId: 'acme', at: '2026-09-06T00:00:00.000Z' });

    const august = l.between('2026-08-01T00:00:00.000Z', '2026-08-31T23:59:59.000Z', 'acme');
    assert.equal(august.length, 1);
    assert.equal(august[0]!.payload.n, 1);
  });

  test('an empty ledger verifies rather than throwing', () => {
    assert.equal(verifyChain([]).ok, true);
  });
});

describe('hashing survives a round trip through disk', () => {
  test('a key whose value is undefined does not change the hash', () => {
    // JSON.stringify drops undefined values, so an entry carrying one hashed
    // differently in memory than after being read back, and the chain failed to
    // verify on every restart. A tamper-evident log that cries wolf is worse
    // than none, because the first thing anyone does is stop believing it.
    const withUndefined = hashEntry({
      seq: 0, at: 'T', kind: 'assertion-confirmed', workflowId: 'w', prevHash: GENESIS_PREV,
      payload: { by: 'harsh', baselineAttestation: undefined },
    });
    const asReloaded = hashEntry({
      seq: 0, at: 'T', kind: 'assertion-confirmed', workflowId: 'w', prevHash: GENESIS_PREV,
      payload: JSON.parse(JSON.stringify({ by: 'harsh', baselineAttestation: undefined })),
    });
    assert.equal(withUndefined, asReloaded);
  });

  test('a real chain verifies after a full serialise and parse', () => {
    const l = new Ledger();
    l.append('assertion-confirmed', 'wf_1', { by: 'harsh', baselineAttestation: undefined });
    l.append('violation', 'wf_1', { detail: 'produced no items', runId: undefined });
    const roundTripped = JSON.parse(JSON.stringify(l.all())) as LedgerEntry[];
    assert.equal(verifyChain(roundTripped).ok, true);
  });
});
