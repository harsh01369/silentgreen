import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store/store';
import { workflowHash, type N8nWorkflowDoc } from '../src/graph/hash';
import type { Assertion, Run } from '../src/contract/types';

function doc(url = 'https://api.example.com/orders'): N8nWorkflowDoc {
  return {
    id: 'wf_1',
    name: 'Order sync',
    nodes: [
      { id: 'trg', name: 'Every hour', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1, parameters: {} },
      { id: 'fetch', name: 'Fetch', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, parameters: { method: 'GET', url } },
      { id: 'db', name: 'Insert', type: 'n8n-nodes-base.postgres', typeVersion: 2, parameters: { operation: 'insert' } },
    ],
    connections: {
      'Every hour': { main: [[{ node: 'Fetch' }]] },
      Fetch: { main: [[{ node: 'Insert' }]] },
    },
  };
}

function runs(n: number): Run[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `run_${i}`,
    workflowId: 'wf_1',
    platform: 'n8n' as const,
    startedAt: new Date(Date.UTC(2026, 8, 1) + i * 3600_000).toISOString(),
    platformStatus: 'success' as const,
    sinkOutputs: { db: [{ order_id: `ORD-${i}`, total: 10 + i }] },
  }));
}

function proposal(over: Partial<Assertion> = {}) {
  return {
    assertion: {
      id: `as_${Math.random().toString(36).slice(2)}`,
      workflowId: 'wf_1',
      sinkId: 'db',
      kind: 'non-empty' as const,
      basis: 'structure' as const,
      statement: 'Insert produces at least one row',
      params: { kind: 'non-empty' as const },
      status: 'proposed' as const,
      createdAt: new Date().toISOString(),
      ...over,
    } as Assertion,
    rationale: 'writes to a database',
    confidence: 'high',
  };
}

let dir: string;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'sg-store-'));
});
after(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows sometimes holds the handle briefly; the temp dir is disposable. */
  }
});

describe('the store survives the process', () => {
  test('a confirmed expectation is still there after a reload', () => {
    const d = join(dir, 'a');
    const s1 = new Store(d);
    s1.observeWorkflow({ id: 'wf_1', platform: 'n8n', name: 'Order sync', active: true, hash: workflowHash(doc()), doc: doc(), runs: runs(10) });
    const p = proposal();
    s1.addProposals([p]);
    const r = s1.confirm(p.assertion.id, {
      by: 'harsh@example.com',
      at: new Date().toISOString(),
      workflowHash: workflowHash(doc()),
      evidenceRunIds: ['run_0'],
    });
    assert.equal(r.ok, true);
    s1.save();

    const s2 = new Store(d);
    const live = s2.assertions('wf_1').filter((a) => a.status === 'confirmed');
    assert.equal(live.length, 1);
    assert.equal(live[0]!.confirmation?.by, 'harsh@example.com');
  });

  test('the ledger reloads and still verifies', () => {
    const d = join(dir, 'a');
    const s = new Store(d);
    assert.equal(s.ledger.verify().ok, true);
    assert.ok(s.ledger.length >= 3, 'observed, proposed and confirmed should all be recorded');
  });

  test('a corrupt state file refuses to load rather than half-loading', () => {
    const d = join(dir, 'corrupt');
    new Store(d).save();
    writeFileSync(join(d, 'state.json'), '{ not json', 'utf8');
    assert.throws(() => new Store(d), /could not be parsed/);
  });
});

describe('rescanning a changed workflow', () => {
  test('editing the graph stales every confirmed expectation and says what moved', () => {
    const d = join(dir, 'b');
    const s = new Store(d);
    const before = doc();
    s.observeWorkflow({ id: 'wf_1', platform: 'n8n', name: 'Order sync', active: true, hash: workflowHash(before), doc: before, runs: runs(10) });
    const p = proposal();
    s.addProposals([p]);
    s.confirm(p.assertion.id, { by: 'h', at: new Date().toISOString(), workflowHash: workflowHash(before), evidenceRunIds: ['run_0'] });

    const after = doc('https://api.example.com/v2/orders');
    const { changes, staled } = s.observeWorkflow({
      id: 'wf_1',
      platform: 'n8n',
      name: 'Order sync',
      active: true,
      hash: workflowHash(after),
      doc: after,
      runs: runs(10),
    });

    assert.equal(staled, 1);
    assert.ok(changes.some((c) => c.kind === 'node-parameters-changed'));
    assert.equal(s.counts('wf_1').confirmed, 0);
    assert.equal(s.counts('wf_1').stale, 1);
  });

  test('a cosmetic edit stales nothing', () => {
    const d = join(dir, 'c');
    const s = new Store(d);
    const before = doc();
    s.observeWorkflow({ id: 'wf_1', platform: 'n8n', name: 'Order sync', active: true, hash: workflowHash(before), doc: before, runs: runs(10) });
    const p = proposal();
    s.addProposals([p]);
    s.confirm(p.assertion.id, { by: 'h', at: new Date().toISOString(), workflowHash: workflowHash(before), evidenceRunIds: ['run_0'] });

    const moved = JSON.parse(JSON.stringify(before)) as N8nWorkflowDoc;
    (moved.nodes as unknown as { position: number[] }[])[1]!.position = [900, 900];

    const { staled } = s.observeWorkflow({
      id: 'wf_1',
      platform: 'n8n',
      name: 'Order sync',
      active: true,
      hash: workflowHash(moved),
      doc: moved,
      runs: runs(10),
    });
    assert.equal(staled, 0, 'dragging a node must not invalidate anybody’s work');
    assert.equal(s.counts('wf_1').confirmed, 1);
  });

  test('rescanning does not re-propose what is already on file', () => {
    const d = join(dir, 'd');
    const s = new Store(d);
    s.observeWorkflow({ id: 'wf_1', platform: 'n8n', name: 'Order sync', active: true, hash: workflowHash(doc()), doc: doc(), runs: runs(10) });
    const first = s.addProposals([proposal()]);
    const second = s.addProposals([proposal()]);
    assert.equal(first.added, 1);
    assert.equal(second.added, 0, 'a nightly scan must not refill the queue with the same forty checks');
    assert.equal(second.skipped, 1);
  });

  test('the observed window is recorded so a reviewer is not asked to guess it', () => {
    const d = join(dir, 'e');
    const s = new Store(d);
    s.observeWorkflow({ id: 'wf_1', platform: 'n8n', name: 'Order sync', active: true, hash: workflowHash(doc()), doc: doc(), runs: runs(10) });
    const wf = s.workflow('wf_1');
    assert.ok(wf?.observedWindow);
    assert.ok(Date.parse(wf.observedWindow.start) < Date.parse(wf.observedWindow.end));
  });

  test('samples span several runs rather than repeating one', () => {
    const d = join(dir, 'f');
    const s = new Store(d);
    s.observeWorkflow({ id: 'wf_1', platform: 'n8n', name: 'Order sync', active: true, hash: workflowHash(doc()), doc: doc(), runs: runs(10) });
    const wf = s.workflow('wf_1');
    assert.ok(wf);
    assert.ok(wf.sampleRunIds.length > 1, `expected samples from several runs, got ${wf.sampleRunIds.length}`);
    const ids = (wf.samples.db ?? []).map((x) => (x as { order_id: string }).order_id);
    assert.equal(new Set(ids).size, ids.length, 'the same row should not appear twice');
  });
});

describe('refusals are recorded, not swallowed', () => {
  test('a refused confirmation appears in the ledger', () => {
    const d = join(dir, 'g');
    const s = new Store(d);
    s.observeWorkflow({ id: 'wf_1', platform: 'n8n', name: 'Order sync', active: true, hash: workflowHash(doc()), doc: doc(), runs: runs(10) });
    const p = proposal({ basis: 'observation' });
    s.addProposals([p]);
    const r = s.confirm(p.assertion.id, {
      by: 'h',
      at: new Date().toISOString(),
      workflowHash: workflowHash(doc()),
      evidenceRunIds: ['run_0'],
    });
    assert.equal(r.ok, false);
    const refusals = s.ledger.forWorkflow('wf_1').filter((e) => e.kind === 'assertion-refused');
    assert.equal(refusals.length, 1);
    assert.equal(s.counts('wf_1').confirmed, 0);
  });
});
