/**
 * The confirmation gate.
 *
 * This is the part of the system that is easy to leave out and expensive to
 * leave out. Every workflow-monitoring tool learns a baseline from history and
 * alerts on deviation. That catches change. It cannot catch a workflow that has
 * been quietly wrong since the day it shipped, because the wrongness is in the
 * baseline.
 *
 * From the n8n community thread where practitioners worked this out in public:
 *
 *   "Canaries that derive expected answers from system output prove only
 *    internal consistency, not correctness."
 *
 *   "Non-circular expectations must come from business stakeholders before
 *    implementation, not derived from test data afterward."
 *
 * So: an expectation learned from output may not become a standard until a
 * person states, on the record, that the window it was learned from was known
 * to be good, and says how they know. If they will not say that, the assertion
 * stays proposed and reports `unproven`. It never quietly turns green.
 *
 * Pure functions only. No I/O, no clock, no network. Every branch is tested.
 */

import type { Assertion, Basis, Confirmation } from './types';

/** Why a confirmation was refused. Each maps to a message a human can act on. */
export type RefusalReason =
  | 'already-confirmed'
  | 'retired'
  | 'observation-without-baseline-attestation'
  | 'baseline-attestation-not-substantive'
  | 'baseline-window-invalid'
  | 'baseline-window-excludes-evidence'
  | 'attestation-on-non-observation-basis'
  | 'no-evidence-runs'
  | 'confirmer-missing'
  | 'workflow-hash-missing'
  | 'workflow-hash-mismatch';

export interface Refusal {
  readonly reason: RefusalReason;
  /** Written for the person who has to fix it, not for a log file. */
  readonly message: string;
}

/**
 * Phrases that look like an attestation but assert nothing checkable. If the
 * only justification for a standard is "looks fine", we have a habit, not a
 * standard, and we should not let it produce green ticks.
 */
const NON_SUBSTANTIVE = [
  'ok',
  'okay',
  'fine',
  'good',
  'looks good',
  'looks fine',
  'lgtm',
  'n/a',
  'na',
  'none',
  'yes',
  'sure',
  'idk',
  'i think so',
  'probably',
  'seems right',
  'no reason',
  'test',
  'asdf',
  '-',
  '.',
];

const MIN_ATTESTATION_CHARS = 12;

function normalise(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
}

/**
 * Is this attestation an actual claim about how the confirmer knows the window
 * was good, or is it a shrug typed to get past a dialog?
 *
 * We cannot verify the content is true. We can refuse to accept a blank cheque,
 * and we can put the sentence in the report next to the green tick it bought,
 * which is a stronger incentive than validation.
 */
export function isSubstantiveAttestation(howKnown: string): boolean {
  const n = normalise(howKnown);
  if (n.length < MIN_ATTESTATION_CHARS) return false;
  if (NON_SUBSTANTIVE.includes(n)) return false;
  // A bare restatement of the ask carries no information either.
  if (/^(it (was|is) )?(known )?good$/.test(n)) return false;
  // Require at least three words, so "verified manually" passes and "ok good" does not.
  if (n.split(' ').filter(Boolean).length < 3) return false;
  return true;
}

/** What a given basis demands before it may produce verdicts. */
export function confirmationRequirements(basis: Basis): {
  readonly needsBaselineAttestation: boolean;
  readonly proves: string;
  readonly doesNotProve: string;
} {
  switch (basis) {
    case 'intent':
      return {
        needsBaselineAttestation: false,
        proves: 'that the workflow is doing the job a person said it was for',
        doesNotProve: 'that the stated job is the job the business currently needs',
      };
    case 'structure':
      return {
        needsBaselineAttestation: false,
        proves: 'that the workflow is doing what its own definition says it does',
        doesNotProve: 'that the definition was ever correct',
      };
    case 'observation':
      return {
        needsBaselineAttestation: true,
        proves: 'that behaviour has not changed since the attested window',
        doesNotProve: 'that behaviour in that window was correct',
      };
  }
}

export interface ConfirmContext {
  /** The workflow revision as it is right now. */
  readonly currentWorkflowHash: string;
}

/**
 * Attempt to promote a proposed assertion to confirmed.
 *
 * Returns either the confirmed assertion or a refusal explaining precisely what
 * is missing. Never throws, never partially applies.
 */
export function confirmAssertion(
  assertion: Assertion,
  confirmation: Confirmation,
  ctx: ConfirmContext,
): { readonly assertion: Assertion } | { readonly refused: Refusal } {
  if (assertion.status === 'confirmed') {
    return refuse('already-confirmed', `"${assertion.statement}" is already confirmed. Retire it and propose a replacement rather than re-confirming.`);
  }
  if (assertion.status === 'retired') {
    return refuse('retired', `"${assertion.statement}" was retired. Retired assertions are kept for the audit trail and cannot be revived.`);
  }

  if (!confirmation.by || !confirmation.by.trim()) {
    return refuse('confirmer-missing', 'A confirmation has to name who took responsibility for it. That name is printed in the client report beside the result it produces.');
  }

  if (!confirmation.workflowHash || !confirmation.workflowHash.trim()) {
    return refuse('workflow-hash-missing', 'A confirmation must be bound to a specific workflow revision, otherwise it silently outlives the thing it describes.');
  }

  if (confirmation.workflowHash !== ctx.currentWorkflowHash) {
    return refuse(
      'workflow-hash-mismatch',
      `This was confirmed against revision ${short(confirmation.workflowHash)} but the workflow is now at ${short(ctx.currentWorkflowHash)}. Re-read the assertion against the current graph before confirming it.`,
    );
  }

  if (confirmation.evidenceRunIds.length === 0) {
    return refuse('no-evidence-runs', 'Confirmations record which runs the confirmer was shown. Approving with no evidence in front of you is the habit this tool exists to interrupt.');
  }

  const req = confirmationRequirements(assertion.basis);

  if (!req.needsBaselineAttestation && confirmation.baselineAttestation) {
    return refuse(
      'attestation-on-non-observation-basis',
      `A baseline attestation only applies to expectations learned from past output. "${assertion.statement}" has basis "${assertion.basis}", so remove the attestation rather than implying this standard came from history.`,
    );
  }

  if (req.needsBaselineAttestation) {
    const att = confirmation.baselineAttestation;
    if (!att) {
      return refuse(
        'observation-without-baseline-attestation',
        `"${assertion.statement}" was learned from what this workflow has been doing, so on its own it proves only that the behaviour has not changed. To make it a standard, state the window you believe was correct and how you know. If you cannot, leave it proposed and it will report as unproven, which is the honest answer.`,
      );
    }
    if (!isValidWindow(att.windowStart, att.windowEnd)) {
      return refuse('baseline-window-invalid', 'The attested window needs a real start and end, with the start before the end.');
    }
    if (!isSubstantiveAttestation(att.howKnown)) {
      return refuse(
        'baseline-attestation-not-substantive',
        'Say how you know that window was good, in a sentence someone could later check. "Reconciled against the client\'s invoice export for March" is an attestation. "Looks fine" is not, and it will be printed next to every green tick it produces.',
      );
    }
  }

  const confirmed: Assertion = {
    ...assertion,
    status: 'confirmed',
    confirmation,
  };
  return { assertion: confirmed };
}

function isValidWindow(start: string, end: string): boolean {
  const s = Date.parse(start);
  const e = Date.parse(end);
  return Number.isFinite(s) && Number.isFinite(e) && s < e;
}

function refuse(reason: RefusalReason, message: string): { readonly refused: Refusal } {
  return { refused: { reason, message } };
}

function short(hash: string): string {
  return hash.slice(0, 10);
}

/**
 * What a set of confirmed assertions can and cannot establish, stated plainly.
 *
 * Reports call this so that a page full of green never implies more than it
 * earned. If every live assertion is `observation` basis, the report says so:
 * nothing here shows the workflow was ever right, only that it has not changed.
 */
export function coverageHonesty(assertions: readonly Assertion[]): {
  readonly live: number;
  readonly byBasis: Readonly<Record<Basis, number>>;
  readonly canEstablishCorrectness: boolean;
  readonly sentence: string;
} {
  const live = assertions.filter((a) => a.status === 'confirmed');
  const byBasis: Record<Basis, number> = { intent: 0, structure: 0, observation: 0 };
  for (const a of live) byBasis[a.basis]++;

  const canEstablishCorrectness = byBasis.intent > 0;

  let sentence: string;
  if (live.length === 0) {
    sentence = 'Nothing is being verified on this workflow. Any green you see elsewhere is the platform reporting that code ran, not that work happened.';
  } else if (!canEstablishCorrectness && byBasis.structure === 0) {
    sentence = `All ${live.length} live checks were learned from this workflow's own past output. They will catch it changing. They cannot show it was ever correct, because the standard came from the thing being measured.`;
  } else if (!canEstablishCorrectness) {
    sentence = `${live.length} live checks, none of which came from a stated business intent. They show the workflow matches its own definition and has not drifted. Whether the definition is right is still unverified.`;
  } else {
    sentence = `${byBasis.intent} of ${live.length} live checks trace back to a stated business intent rather than to past output, so they can establish correctness and not merely consistency.`;
  }

  return { live: live.length, byBasis, canEstablishCorrectness, sentence };
}
