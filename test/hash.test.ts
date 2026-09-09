import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { workflowHash, diffWorkflows, canonicalise } from '../src/graph/hash';
import type { N8nWorkflowDoc } from '../src/graph/hash';

function base(): N8nWorkflowDoc {
  return {
    name: 'Invoice sync',
    nodes: [
      {
        id: 'n1',
        name: 'Schedule Trigger',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2,
        position: [0, 0],
        parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } },
      },
      {
        id: 'n2',
        name: 'Fetch invoices',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [200, 0],
        parameters: { url: 'https://api.example.com/invoices', method: 'GET' },
      },
      {
        id: 'n3',
        name: 'Append to sheet',
        type: 'n8n-nodes-base.googleSheets',
        typeVersion: 4,
        position: [400, 0],
        parameters: { operation: 'append', documentId: 'abc' },
        credentials: { googleSheetsOAuth2Api: { id: '1', name: 'sheets' } },
      },
    ],
    connections: {
      'Schedule Trigger': { main: [[{ node: 'Fetch invoices', type: 'main', index: 0 }]] },
      'Fetch invoices': { main: [[{ node: 'Append to sheet', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}

function clone(d: N8nWorkflowDoc): N8nWorkflowDoc {
  return JSON.parse(JSON.stringify(d)) as N8nWorkflowDoc;
}

describe('semantic hashing: cosmetic edits must not invalidate a contract', () => {
  test('the same document hashes the same', () => {
    assert.equal(workflowHash(base()), workflowHash(base()));
  });

  test('moving a node on the canvas is cosmetic', () => {
    const d = clone(base());
    (d.nodes as any)[1].position = [999, 555];
    assert.equal(workflowHash(d), workflowHash(base()));
  });

  test('renaming a node is cosmetic, including in the connections map', () => {
    const d = clone(base());
    (d.nodes as any)[1].name = 'Get the invoices';
    (d.connections as any)['Get the invoices'] = (d.connections as any)['Fetch invoices'];
    delete (d.connections as any)['Fetch invoices'];
    (d.connections as any)['Schedule Trigger'].main[0][0].node = 'Get the invoices';
    assert.equal(workflowHash(d), workflowHash(base()), 'a rename rewrites the document without changing the graph');
  });

  test('adding a sticky note colour or a comment is cosmetic', () => {
    const d = clone(base());
    (d.nodes as any)[0].notes = 'runs hourly, ask Priya before changing';
    (d.nodes as any)[0].color = '#ff0000';
    assert.equal(workflowHash(d), workflowHash(base()));
  });

  test('reordering nodes in the array is cosmetic', () => {
    const d = clone(base());
    (d as any).nodes = [...(d.nodes as any)].reverse();
    assert.equal(workflowHash(d), workflowHash(base()));
  });
});

describe('semantic hashing: meaningful edits must invalidate a contract', () => {
  test('changing an HTTP target changes the hash', () => {
    const d = clone(base());
    (d.nodes as any)[1].parameters.url = 'https://api.example.com/v2/invoices';
    assert.notEqual(workflowHash(d), workflowHash(base()));
  });

  test('disabling a node changes the hash', () => {
    const d = clone(base());
    (d.nodes as any)[2].disabled = true;
    assert.notEqual(workflowHash(d), workflowHash(base()));
  });

  test('rewiring changes the hash', () => {
    const d = clone(base());
    (d.connections as any)['Schedule Trigger'].main[0][0].node = 'Append to sheet';
    assert.notEqual(workflowHash(d), workflowHash(base()));
  });

  test('a node type version bump changes the hash', () => {
    const d = clone(base());
    (d.nodes as any)[2].typeVersion = 5;
    assert.notEqual(workflowHash(d), workflowHash(base()));
  });

  test('removing a node changes the hash', () => {
    const d = clone(base());
    (d as any).nodes = (d.nodes as any).slice(0, 2);
    assert.notEqual(workflowHash(d), workflowHash(base()));
  });
});

describe('canonicalisation details', () => {
  test('edges pointing at deleted nodes are dropped rather than throwing', () => {
    const d = clone(base());
    (d as any).nodes = (d.nodes as any).filter((n: any) => n.id !== 'n3');
    const c = canonicalise(d);
    assert.equal(c.nodes.length, 2);
    assert.ok(c.edges.every((e) => e.to !== 'n3'), 'no edge should point at a node that is gone');
  });

  test('credential types are part of identity but credential values are never read', () => {
    const d = clone(base());
    (d.nodes as any)[2].credentials = { googleSheetsOAuth2Api: { id: '99', name: 'a different account' } };
    assert.equal(workflowHash(d), workflowHash(base()), 'swapping the account is not a graph change');

    const e = clone(base());
    (e.nodes as any)[2].credentials = { someOtherApi: { id: '1', name: 'x' } };
    assert.notEqual(workflowHash(e), workflowHash(base()), 'swapping the credential type is a graph change');
  });
});

describe('explaining what changed', () => {
  test('a disabled node is described in terms of its downstream consequence', () => {
    const after = clone(base());
    (after.nodes as any)[2].disabled = true;
    const changes = diffWorkflows(base(), after);
    const c = changes.find((x) => x.kind === 'node-disabled');
    assert.ok(c, 'expected a node-disabled change');
    assert.match(c.description, /Append to sheet/);
    assert.match(c.description, /may now receive nothing while the run still reports success/);
  });

  test('a removed node warns that checks bound to it can no longer be evaluated', () => {
    const after = clone(base());
    (after as any).nodes = (after.nodes as any).slice(0, 2);
    const changes = diffWorkflows(base(), after);
    const c = changes.find((x) => x.kind === 'node-removed');
    assert.ok(c);
    assert.match(c.description, /can no longer be evaluated/);
  });

  test('a parameter change names the node a human would recognise', () => {
    const after = clone(base());
    (after.nodes as any)[1].parameters.url = 'https://elsewhere.example.com/';
    const changes = diffWorkflows(base(), after);
    const c = changes.find((x) => x.kind === 'node-parameters-changed');
    assert.ok(c);
    assert.match(c.description, /"Fetch invoices"/);
  });

  test('an identical document produces no changes', () => {
    assert.deepEqual(diffWorkflows(base(), clone(base())), []);
  });

  test('rewiring is reported as both an added and a removed edge', () => {
    const after = clone(base());
    (after.connections as any)['Schedule Trigger'].main[0][0].node = 'Append to sheet';
    const changes = diffWorkflows(base(), after);
    assert.ok(changes.some((c) => c.kind === 'edge-added'));
    assert.ok(changes.some((c) => c.kind === 'edge-removed'));
  });
});
