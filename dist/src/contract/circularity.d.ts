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
export type RefusalReason = 'already-confirmed' | 'retired' | 'observation-without-baseline-attestation' | 'baseline-attestation-not-substantive' | 'baseline-window-invalid' | 'baseline-window-excludes-evidence' | 'attestation-on-non-observation-basis' | 'no-evidence-runs' | 'confirmer-missing' | 'workflow-hash-missing' | 'workflow-hash-mismatch';
export interface Refusal {
    readonly reason: RefusalReason;
    /** Written for the person who has to fix it, not for a log file. */
    readonly message: string;
}
/**
 * Is this attestation an actual claim about how the confirmer knows the window
 * was good, or is it a shrug typed to get past a dialog?
 *
 * We cannot verify the content is true. We can refuse to accept a blank cheque,
 * and we can put the sentence in the report next to the green tick it bought,
 * which is a stronger incentive than validation.
 */
export declare function isSubstantiveAttestation(howKnown: string): boolean;
/** What a given basis demands before it may produce verdicts. */
export declare function confirmationRequirements(basis: Basis): {
    readonly needsBaselineAttestation: boolean;
    readonly proves: string;
    readonly doesNotProve: string;
};
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
export declare function confirmAssertion(assertion: Assertion, confirmation: Confirmation, ctx: ConfirmContext): {
    readonly assertion: Assertion;
} | {
    readonly refused: Refusal;
};
/**
 * What a set of confirmed assertions can and cannot establish, stated plainly.
 *
 * Reports call this so that a page full of green never implies more than it
 * earned. If every live assertion is `observation` basis, the report says so:
 * nothing here shows the workflow was ever right, only that it has not changed.
 */
export declare function coverageHonesty(assertions: readonly Assertion[]): {
    readonly live: number;
    readonly byBasis: Readonly<Record<Basis, number>>;
    readonly canEstablishCorrectness: boolean;
    readonly sentence: string;
};
