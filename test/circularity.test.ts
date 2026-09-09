import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { confirmAssertion, isSubstantiveAttestation, coverageHonesty, confirmationRequirements } from '../src/contract/circularity';
import type { Assertion, Confirmation } from '../src/contract/types';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function makeAssertion(over: Partial<Assertion> = {}): Assertion {
  return {
    id: 'as_1',
    workflowId: 'wf_1',
    sinkId: 'node_sheets',
    kind: 'non-empty',
    basis: 'intent',
    statement: 'Every run files at least one invoice row',
    params: { kind: 'non-empty' },
    status: 'proposed',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

function makeConfirmation(over: Partial<Confirmation> = {}): Confirmation {
  return {
    by: 'harsh@example.com',
    at: '2026-09-02T10:00:00.000Z',
    workflowHash: HASH_A,
    evidenceRunIds: ['run_1', 'run_2'],
    ...over,
  };
}

describe('the confirmation gate', () => {
  test('an intent assertion confirms cleanly', () => {
    const r = confirmAssertion(makeAssertion(), makeConfirmation(), { currentWorkflowHash: HASH_A });
    assert.ok('assertion' in r);
    assert.equal(r.assertion.status, 'confirmed');
    assert.equal(r.assertion.confirmation?.by, 'harsh@example.com');
  });

  test('an observation assertion is refused without a baseline attestation', () => {
    const r = confirmAssertion(
      makeAssertion({ basis: 'observation' }),
      makeConfirmation(),
      { currentWorkflowHash: HASH_A },
    );
    assert.ok('refused' in r);
    assert.equal(r.refused.reason, 'observation-without-baseline-attestation');
  });

  test('an observation assertion confirms with a substantive attestation', () => {
    const r = confirmAssertion(
      makeAssertion({ basis: 'observation' }),
      makeConfirmation({
        baselineAttestation: {
          windowStart: '2026-08-01T00:00:00.000Z',
          windowEnd: '2026-08-31T00:00:00.000Z',
          howKnown: 'Reconciled every row against the client invoice export for August',
        },
      }),
      { currentWorkflowHash: HASH_A },
    );
    assert.ok('assertion' in r);
    assert.equal(r.assertion.status, 'confirmed');
  });

  test('a shrug is not an attestation', () => {
    for (const howKnown of ['ok', 'looks fine', 'yes', 'lgtm', '.', 'good', 'seems right', 'test']) {
      const r = confirmAssertion(
        makeAssertion({ basis: 'observation' }),
        makeConfirmation({
          baselineAttestation: { windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-31T00:00:00.000Z', howKnown },
        }),
        { currentWorkflowHash: HASH_A },
      );
      assert.ok('refused' in r, `"${howKnown}" should have been refused`);
      assert.equal(r.refused.reason, 'baseline-attestation-not-substantive');
    }
  });

  test('a real justification passes the substantiveness bar', () => {
    assert.equal(isSubstantiveAttestation('Reconciled against the client invoice export'), true);
    assert.equal(isSubstantiveAttestation('Client signed off on the March output'), true);
    assert.equal(isSubstantiveAttestation('verified manually row by row'), true);
    assert.equal(isSubstantiveAttestation('fine'), false);
    assert.equal(isSubstantiveAttestation('it was good'), false);
  });

  test('an inverted baseline window is refused', () => {
    const r = confirmAssertion(
      makeAssertion({ basis: 'observation' }),
      makeConfirmation({
        baselineAttestation: {
          windowStart: '2026-08-31T00:00:00.000Z',
          windowEnd: '2026-08-01T00:00:00.000Z',
          howKnown: 'Reconciled against the client invoice export for August',
        },
      }),
      { currentWorkflowHash: HASH_A },
    );
    assert.ok('refused' in r);
    assert.equal(r.refused.reason, 'baseline-window-invalid');
  });

  test('an attestation on an intent assertion is refused, so history cannot be laundered as intent', () => {
    const r = confirmAssertion(
      makeAssertion({ basis: 'intent' }),
      makeConfirmation({
        baselineAttestation: { windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-31T00:00:00.000Z', howKnown: 'Reconciled against the export' },
      }),
      { currentWorkflowHash: HASH_A },
    );
    assert.ok('refused' in r);
    assert.equal(r.refused.reason, 'attestation-on-non-observation-basis');
  });

  test('confirmation against a superseded revision is refused', () => {
    const r = confirmAssertion(makeAssertion(), makeConfirmation({ workflowHash: HASH_A }), { currentWorkflowHash: HASH_B });
    assert.ok('refused' in r);
    assert.equal(r.refused.reason, 'workflow-hash-mismatch');
  });

  test('confirming with no evidence in front of you is refused', () => {
    const r = confirmAssertion(makeAssertion(), makeConfirmation({ evidenceRunIds: [] }), { currentWorkflowHash: HASH_A });
    assert.ok('refused' in r);
    assert.equal(r.refused.reason, 'no-evidence-runs');
  });

  test('an anonymous confirmation is refused', () => {
    const r = confirmAssertion(makeAssertion(), makeConfirmation({ by: '   ' }), { currentWorkflowHash: HASH_A });
    assert.ok('refused' in r);
    assert.equal(r.refused.reason, 'confirmer-missing');
  });

  test('a retired assertion cannot be revived', () => {
    const r = confirmAssertion(makeAssertion({ status: 'retired' }), makeConfirmation(), { currentWorkflowHash: HASH_A });
    assert.ok('refused' in r);
    assert.equal(r.refused.reason, 'retired');
  });

  test('confirming twice is refused', () => {
    const r = confirmAssertion(makeAssertion({ status: 'confirmed' }), makeConfirmation(), { currentWorkflowHash: HASH_A });
    assert.ok('refused' in r);
    assert.equal(r.refused.reason, 'already-confirmed');
  });
});

describe('what a basis can and cannot establish', () => {
  test('only observation demands a baseline attestation', () => {
    assert.equal(confirmationRequirements('observation').needsBaselineAttestation, true);
    assert.equal(confirmationRequirements('intent').needsBaselineAttestation, false);
    assert.equal(confirmationRequirements('structure').needsBaselineAttestation, false);
  });
});

describe('honesty about coverage', () => {
  test('no live checks is stated as such, not as a pass', () => {
    const h = coverageHonesty([makeAssertion({ status: 'proposed' })]);
    assert.equal(h.live, 0);
    assert.equal(h.canEstablishCorrectness, false);
    assert.match(h.sentence, /Nothing is being verified/);
  });

  test('all-observation coverage says it cannot show correctness', () => {
    const h = coverageHonesty([
      makeAssertion({ id: 'a', basis: 'observation', status: 'confirmed' }),
      makeAssertion({ id: 'b', basis: 'observation', status: 'confirmed' }),
    ]);
    assert.equal(h.canEstablishCorrectness, false);
    assert.match(h.sentence, /cannot show it was ever correct/);
  });

  test('structure-only coverage is distinguished from observation-only', () => {
    const h = coverageHonesty([makeAssertion({ basis: 'structure', status: 'confirmed' })]);
    assert.equal(h.canEstablishCorrectness, false);
    assert.match(h.sentence, /matches its own definition/);
  });

  test('one intent check flips the claim to correctness', () => {
    const h = coverageHonesty([
      makeAssertion({ id: 'a', basis: 'intent', status: 'confirmed' }),
      makeAssertion({ id: 'b', basis: 'observation', status: 'confirmed' }),
    ]);
    assert.equal(h.canEstablishCorrectness, true);
    assert.equal(h.byBasis.intent, 1);
    assert.match(h.sentence, /establish correctness and not merely consistency/);
  });
});
