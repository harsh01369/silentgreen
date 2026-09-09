import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, matchDegenerate, fieldValue, testPredicate } from '../src/verify/assert';
import type { Assertion, AssertionParams, Run } from '../src/contract/types';

const HASH = 'c'.repeat(64);

function confirmed(params: AssertionParams, over: Partial<Assertion> = {}): Assertion {
  return {
    id: 'as_1',
    workflowId: 'wf_1',
    sinkId: 'sink',
    kind: params.kind,
    basis: 'intent',
    statement: 'test assertion',
    params,
    status: 'confirmed',
    confirmation: { by: 'h', at: '2026-09-01T00:00:00.000Z', workflowHash: HASH, evidenceRunIds: ['r1'] },
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function run(sinkItems: unknown[] | undefined, triggerInput?: unknown[]): Run {
  return {
    id: 'run_1',
    workflowId: 'wf_1',
    platform: 'n8n',
    startedAt: '2026-09-08T10:00:00.000Z',
    platformStatus: 'success',
    sinkOutputs: sinkItems === undefined ? {} : { sink: sinkItems },
    triggerInput,
  };
}

describe('nothing turns green by accident', () => {
  test('a proposed assertion is unproven, never proven', () => {
    const r = evaluate(confirmed({ kind: 'non-empty' }, { status: 'proposed', confirmation: undefined }), run([{ a: 1 }]));
    assert.equal(r.verdict, 'unproven');
    assert.equal(r.unprovenReason, 'only-proposed-assertions');
  });

  test('a stale assertion is unproven even when the data would satisfy it', () => {
    const r = evaluate(confirmed({ kind: 'non-empty' }, { status: 'stale' }), run([{ a: 1 }]));
    assert.equal(r.verdict, 'unproven');
    assert.equal(r.unprovenReason, 'contract-stale');
  });

  test('a run against a different workflow revision is unproven', () => {
    const r = evaluate(confirmed({ kind: 'non-empty' }), run([{ a: 1 }]), { currentWorkflowHash: 'd'.repeat(64) });
    assert.equal(r.verdict, 'unproven');
    assert.equal(r.unprovenReason, 'contract-stale');
  });

  test('an uncaptured sink is unproven, not proven', () => {
    const r = evaluate(confirmed({ kind: 'non-empty' }), run(undefined));
    assert.equal(r.verdict, 'unproven');
    assert.equal(r.unprovenReason, 'sink-not-captured');
  });
});

describe('the 200 OK that did nothing', () => {
  test('zero items on a successful run is a violation', () => {
    const r = evaluate(confirmed({ kind: 'non-empty' }), run([]));
    assert.equal(r.verdict, 'violated');
    assert.match(r.detail ?? '', /still reported success/);
  });

  test('items present is proven with a count as evidence', () => {
    const r = evaluate(confirmed({ kind: 'non-empty' }), run([{ a: 1 }, { a: 2 }]));
    assert.equal(r.verdict, 'proven');
    assert.equal(r.evidence, '2 item(s)');
  });

  test('a volume collapse is caught', () => {
    const r = evaluate(confirmed({ kind: 'volume', min: 40, max: 60 }), run([{ a: 1 }]));
    assert.equal(r.verdict, 'violated');
    assert.match(r.detail ?? '', /Expected between 40 and 60 items, found 1/);
  });
});

describe('degenerate values', () => {
  test('an unrendered template is caught', () => {
    assert.equal(matchDegenerate('Hello {{ $json.firstName }}, your order shipped', 'unrendered-template'), true);
    assert.equal(matchDegenerate('Hello Priya, your order shipped', 'unrendered-template'), false);
  });

  test('a model refusal carried downstream as content is caught', () => {
    assert.equal(matchDegenerate("I'm sorry, but I cannot generate that summary.", 'model-refusal'), true);
    assert.equal(matchDegenerate('As an AI language model, I do not have access to that.', 'model-refusal'), true);
    assert.equal(matchDegenerate('The quarterly summary is attached.', 'model-refusal'), false);
  });

  test('stringified objects and stack traces are caught', () => {
    assert.equal(matchDegenerate('[object Object]', 'error-text-in-value'), true);
    assert.equal(matchDegenerate('Error: connect ECONNREFUSED 127.0.0.1:5432', 'error-text-in-value'), true);
    assert.equal(matchDegenerate('Request failed with status code 502', 'error-text-in-value'), true);
    assert.equal(matchDegenerate('An error message field describing a refund', 'error-text-in-value'), false);
  });

  test('the text "null" is distinguished from a real null', () => {
    assert.equal(matchDegenerate('null', 'null-literal'), true);
    assert.equal(matchDegenerate('undefined', 'null-literal'), true);
    assert.equal(matchDegenerate(null, 'null-literal'), false, 'a real null is a shape problem, not a text one');
    assert.equal(matchDegenerate('nullify the contract', 'null-literal'), false);
  });

  test('truncation is only claimed at a plausible field boundary', () => {
    assert.equal(matchDegenerate(`${'x'.repeat(252)}...`, 'truncation-marker'), true, '255 is a classic column width');
    assert.equal(matchDegenerate('Wait for it...', 'truncation-marker'), false, 'ordinary prose must not be accused');
  });

  test('a degenerate field violates with the literal value as evidence', () => {
    const r = evaluate(
      confirmed({ kind: 'not-degenerate', fields: ['body'], patterns: ['unrendered-template', 'model-refusal'] }),
      run([{ body: 'Hi {{ $json.name }}' }]),
    );
    assert.equal(r.verdict, 'violated');
    assert.equal(r.evidence, 'Hi {{ $json.name }}');
    assert.match(r.detail ?? '', /never substituted/);
  });

  test('a missing field is not treated as a degenerate value', () => {
    const r = evaluate(
      confirmed({ kind: 'not-degenerate', fields: ['body'], patterns: ['empty-string'] }),
      run([{ subject: 'no body key here' }]),
    );
    assert.equal(r.verdict, 'proven', 'absence is a shape concern and belongs to a shape assertion');
  });
});

describe('shape', () => {
  test('a missing field is a violation naming the item', () => {
    const r = evaluate(confirmed({ kind: 'shape', fields: ['email', 'total'] }), run([{ email: 'a@b.c' }]));
    assert.equal(r.verdict, 'violated');
    assert.match(r.detail ?? '', /no field "total"/);
  });

  test('a present-but-null field is a violation by default', () => {
    const r = evaluate(confirmed({ kind: 'shape', fields: ['total'] }), run([{ total: null }]));
    assert.equal(r.verdict, 'violated');
    assert.match(r.detail ?? '', /its value is null/);
  });

  test('null is allowed when the contract says so', () => {
    const r = evaluate(confirmed({ kind: 'shape', fields: ['total'], allowNull: true }), run([{ total: null }]));
    assert.equal(r.verdict, 'proven');
  });

  test('dot paths resolve into nested objects', () => {
    assert.deepEqual(fieldValue({ customer: { email: 'a@b.c' } }, 'customer.email'), { found: true, value: 'a@b.c' });
    assert.deepEqual(fieldValue({ customer: {} }, 'customer.email'), { found: false, value: undefined });
  });
});

describe('referential integrity: proving the pipe carried the data', () => {
  test('output that did not come from the input is caught', () => {
    const r = evaluate(
      confirmed({ kind: 'referential', sourceField: 'orderId', sinkField: 'order_id' }),
      run([{ order_id: 'ORD-999' }], [{ orderId: 'ORD-001' }, { orderId: 'ORD-002' }]),
    );
    assert.equal(r.verdict, 'violated');
    assert.match(r.detail ?? '', /did not come from its input/);
  });

  test('output traced back to the input is proven', () => {
    const r = evaluate(
      confirmed({ kind: 'referential', sourceField: 'orderId', sinkField: 'order_id' }),
      run([{ order_id: 'ORD-001' }], [{ orderId: 'ORD-001' }, { orderId: 'ORD-002' }]),
    );
    assert.equal(r.verdict, 'proven');
  });

  test('with no captured trigger input the result is unproven, not a pass', () => {
    const r = evaluate(
      confirmed({ kind: 'referential', sourceField: 'orderId', sinkField: 'order_id' }),
      run([{ order_id: 'ORD-001' }]),
    );
    assert.equal(r.verdict, 'unproven');
    assert.equal(r.unprovenReason, 'run-data-unavailable');
  });
});

describe('predicates', () => {
  test('comparison operators behave', () => {
    assert.equal(testPredicate('10', 'gt', 5), true);
    assert.equal(testPredicate('10', 'lt', 5), false);
    assert.equal(testPredicate('abc', 'matches', '^a'), true);
    assert.equal(testPredicate('abc', 'not-matches', '^z'), true);
    assert.equal(testPredicate('abc', 'equals', 'abc'), true);
  });

  test('an unparseable pattern fails closed instead of throwing', () => {
    assert.doesNotThrow(() => testPredicate('anything', 'matches', '([unclosed'));
    assert.equal(testPredicate('anything', 'matches', '([unclosed'), false);
  });
});
