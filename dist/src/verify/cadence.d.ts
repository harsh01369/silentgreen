/**
 * Absence detection: the failure that leaves no trace.
 *
 * Every other check in this system reacts to something that happened. This one
 * has to react to something that did not. A scheduled workflow that stops
 * firing writes no execution, raises no error and appears nowhere in an
 * executions list, so a monitoring tool built on events is structurally blind
 * to it. From the community thread:
 *
 *   "Missing scheduled workflow detection: workflows that stop running produce
 *    no execution logs."
 *
 * The hard part is not the alarm, it is the false alarm. A workflow that runs
 * hourly on weekdays has a 63 hour gap every weekend, and a naive median
 * interval will page someone at 02:00 on Saturday. Do that twice and the alerts
 * get muted, which returns the client to exactly where they started.
 *
 * So we model the calendar the runs actually observe, and we state our
 * confidence rather than pretending to certainty on six data points.
 */
import type { Assertion, AssertionResult, Run } from '../contract/types';
export interface CadenceProfile {
    /** Typical gap between runs, in seconds, robust to outliers. */
    readonly medianIntervalSeconds: number;
    /** Gap we would be surprised to exceed, in seconds. */
    readonly p95IntervalSeconds: number;
    /** True when no run has ever started on a Saturday or Sunday. */
    readonly weekdaysOnly: boolean;
    /** Local hours during which runs occur, when clearly bounded. */
    readonly activeHours?: {
        readonly from: number;
        readonly to: number;
    };
    readonly sampleSize: number;
    /**
     * How much to trust this. Low confidence profiles are still worth proposing,
     * but they must be confirmed by a human before they can raise anything.
     */
    readonly confidence: 'low' | 'moderate' | 'high';
    /** Written for the person deciding whether to confirm it. */
    readonly reasoning: string;
}
/**
 * Learn the rhythm a workflow actually keeps.
 *
 * Note the basis this produces: `observation`. It is learned from the system's
 * own history, so on its own it establishes only that the rhythm has not
 * changed. Confirming it requires the baseline attestation, same as any other
 * observation. That is deliberate: a workflow that was already firing half as
 * often as it should would otherwise have its own mistake ratified as the
 * standard.
 */
export declare function inferCadence(runs: readonly Run[]): CadenceProfile | null;
export interface CadenceContext {
    readonly now: Date;
    /** Set when the profile that produced this assertion knew about weekends. */
    readonly weekdaysOnly?: boolean;
    /**
     * The hours of the day this workflow actually works, inclusive. Silence
     * outside them is expected rather than suspicious.
     */
    readonly activeHours?: {
        readonly from: number;
        readonly to: number;
    };
    /**
     * The workflow's current revision. A cadence expectation is bound to a
     * revision exactly like any other: a schedule confirmed against one graph
     * says nothing about a graph that has since been rewired.
     */
    readonly currentWorkflowHash?: string;
}
/**
 * Has this workflow gone quiet?
 *
 * Returns `violated` only when the workflow has been silent for longer than its
 * expected interval plus its grace, with weekend time discounted when the
 * profile says so. Returns `unproven` when we simply have no runs to reason
 * from, because "we have never seen it run" and "it has stopped running" are
 * different statements and conflating them is how a tool earns distrust.
 */
export declare function evaluateCadence(assertion: Assertion, runs: readonly Run[], ctx: CadenceContext): AssertionResult;
export declare function humanise(seconds: number): string;
