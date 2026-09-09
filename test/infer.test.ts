import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findSinks } from '../src/contract/sinks';
import { proposeFromStructure, proposeFromObservation } from '../src/contract/infer';
import { workflowHash, type N8nWorkflowDoc } from '../src/graph/hash';
import type { Run } from '../src/contract/types';

const doc: N8nWorkflowDoc = {
  id: 'wf_1',
  name: 'Daily digest',
  nodes: [
    { id: 'n1', name: 'Schedule', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1, parameters: {} },
    { id: 'n2', name: 'Fetch orders', type: 'n8n-nodes-base.httpRequest', typeVersion: 4, parameters: { method: 'GET', url: 'https://api.example.com/orders' } },
    { id: 'n3', name: 'Summarise', type: '@n8n/n8n-nodes-langchain.chainLlm', typeVersion: 1, parameters: {} },
    { id: 'n4', name: 'Email the team', type: 'n8n-nodes-base.gmail', typeVersion: 2, parameters: { operation: 'send' } },
    { id: 'n5', name: 'Log to sheet', type: 'n8n-nodes-base.googleSheets', typeVersion: 4, parameters: { operation: 'append' } },
    { id: 'n6', name: 'Tidy fields', type: 'n8n-nodes-base.set', typeVersion: 3, parameters: {} },
  ],
  connections: {
    Schedule: { main: [[{ node: 'Fetch orders' }]] },
    'Fetch orders': { main: [[{ node: 'Summarise' }]] },
    Summarise: { main: [[{ node: 'Email the team' }, { node: 'Log to sheet' }]] },
  },
};

describe('finding the steps that matter', () => {
  const sinks = findSinks(doc);
  const byName = new Map(sinks.map((s) => [s.nodeName, s]));

  test('triggers are never sinks', () => {
    assert.equal(byName.has('Schedule'), false);
  });

  test('a GET is treated as a source, not a side effect', () => {
    assert.equal(byName.has('Fetch orders'), false, 'a GET fetches data; contracting it produces noise');
  });

  test('writes to the world are found', () => {
    assert.ok(byName.has('Email the team'));
    assert.ok(byName.has('Log to sheet'));
    assert.equal(byName.get('Email the team')!.category, 'email');
    assert.equal(byName.get('Log to sheet')!.category, 'spreadsheet');
  });

  test('a generation step is found because its failures are invisible to a status code', () => {
    assert.ok(byName.has('Summarise'));
    assert.equal(byName.get('Summarise')!.category, 'ai-generation');
  });

  test('a plumbing node with nothing downstream is not dressed up as important', () => {
    const tidy = byName.get('Tidy fields');
    assert.equal(tidy, undefined, 'a Set node is not where work leaves the system');
  });

  test('rationales are written for a person, not a log file', () => {
    assert.match(byName.get('Email the team')!.rationale, /reaches a real inbox and cannot be recalled/);
    assert.match(byName.get('Log to sheet')!.rationale, /a person will later read as fact/);
  });

  test('terminal sinks outrank mid-graph ones', () => {
    assert.ok(byName.get('Email the team')!.terminal);
    assert.ok(!byName.get('Summarise')!.terminal);
  });
});

describe('structural proposals', () => {
  const sinks = findSinks(doc);
  const proposals = proposeFromStructure('wf_1', workflowHash(doc), sinks);

  test('every proposal starts life unconfirmed', () => {
    assert.ok(proposals.length > 0);
    assert.ok(proposals.every((p) => p.assertion.status === 'proposed'));
    assert.ok(proposals.every((p) => p.assertion.confirmation === undefined));
  });

  test('structural proposals declare their basis honestly', () => {
    assert.ok(proposals.every((p) => p.assertion.basis === 'structure'));
  });

  test('generated and delivered text gets a degeneracy check', () => {
    const p = proposals.find((x) => x.assertion.sinkId === 'n3' && x.assertion.kind === 'not-degenerate');
    assert.ok(p, 'the LLM step should be guarded against refusals and unrendered templates');
    const params = p.assertion.params as unknown as { patterns: string[] };
    assert.ok(params.patterns.includes('model-refusal'));
    assert.ok(params.patterns.includes('unrendered-template'));
  });

  test('a spreadsheet write does not get a refusal check, because that would be noise', () => {
    const p = proposals.find((x) => x.assertion.sinkId === 'n5' && x.assertion.kind === 'not-degenerate');
    assert.equal(p, undefined);
  });
});

function runsWith(counts: readonly number[], item: () => unknown): Run[] {
  return counts.map((c, i) => ({
    id: `run_${i}`,
    workflowId: 'wf_1',
    platform: 'n8n' as const,
    startedAt: new Date(Date.UTC(2026, 8, 1) + i * 3600_000).toISOString(),
    platformStatus: 'success' as const,
    sinkOutputs: { n5: Array.from({ length: c }, item) },
  }));
}

describe('observational proposals', () => {
  test('too little history produces nothing rather than a guess', () => {
    const p = proposeFromObservation('wf_1', findSinks(doc), runsWith([5, 5, 5], () => ({ a: 1 })));
    assert.equal(p.length, 0);
  });

  test('a volume envelope is learned and labelled as observation', () => {
    const runs = runsWith([48, 51, 49, 52, 50, 47, 53, 50, 49, 51, 50, 48], () => ({ orderId: 'x', total: 10 }));
    const proposals = proposeFromObservation('wf_1', findSinks(doc), runs);
    const vol = proposals.find((p) => p.assertion.kind === 'volume');
    assert.ok(vol);
    assert.equal(vol.assertion.basis, 'observation', 'learned from output, so it must say so');
    const params = vol.assertion.params as unknown as { min: number; max: number };
    assert.ok(params.min < 47 && params.max > 53, 'bounds are set wide enough to catch collapse, not variation');
  });

  test('the rationale explains what the bounds are for', () => {
    const runs = runsWith([48, 51, 49, 52, 50, 47, 53, 50, 49, 51, 50, 48], () => ({ orderId: 'x', total: 10 }));
    const vol = proposeFromObservation('wf_1', findSinks(doc), runs).find((p) => p.assertion.kind === 'volume');
    assert.match(vol!.rationale, /catches a collapse or a runaway rather than ordinary variation/);
  });

  test('ubiquitous fields become a shape proposal', () => {
    const runs = runsWith(Array(12).fill(5), () => ({ orderId: 'ORD-1', total: 42, customer: { email: 'a@b.c' } }));
    const shape = proposeFromObservation('wf_1', findSinks(doc), runs).find((p) => p.assertion.kind === 'shape');
    assert.ok(shape);
    const fields = (shape.assertion.params as unknown as { fields: string[] }).fields;
    assert.ok(fields.includes('orderId'));
    assert.ok(fields.includes('customer.email'), 'nested paths are discovered too');
  });

  test('a field that is only sometimes present does not become a requirement', () => {
    let n = 0;
    const runs = runsWith(Array(12).fill(5), () => {
      n += 1;
      return n % 2 === 0 ? { orderId: 'ORD-1', coupon: 'X' } : { orderId: 'ORD-1' };
    });
    const shape = proposeFromObservation('wf_1', findSinks(doc), runs).find((p) => p.assertion.kind === 'shape');
    const fields = (shape!.assertion.params as unknown as { fields: string[] }).fields;
    assert.ok(fields.includes('orderId'));
    assert.ok(!fields.includes('coupon'), 'an optional field must not be promoted to mandatory');
  });

  test('a cadence proposal is produced and explains why absence is invisible', () => {
    const runs = runsWith(Array(24).fill(3), () => ({ orderId: 'x' }));
    const cad = proposeFromObservation('wf_1', findSinks(doc), runs).find((p) => p.assertion.kind === 'cadence');
    assert.ok(cad);
    assert.match(cad.rationale, /writes no execution and raises no error/);
  });

  test('every observational proposal is marked observation, never intent', () => {
    const runs = runsWith(Array(20).fill(4), () => ({ orderId: 'x', note: 'a reasonably long string of prose here' }));
    const proposals = proposeFromObservation('wf_1', findSinks(doc), runs);
    assert.ok(proposals.length > 0);
    assert.ok(proposals.every((p) => p.assertion.basis === 'observation'));
  });
});
