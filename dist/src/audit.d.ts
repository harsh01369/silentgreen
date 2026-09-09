/**
 * Putting it together: a contract, a pile of runs, and an honest answer.
 *
 * The output deliberately separates three counts that most dashboards merge
 * into one number:
 *
 *   proven    we checked, against real captured output, and it held
 *   violated  we checked and it did not hold, and here is the value
 *   unproven  we did not establish this, and here is exactly why
 *
 * The third number is the one that matters and the one nobody reports. A page
 * showing "0 problems" while quietly meaning "we checked nothing" is the same
 * failure as a workflow reporting success while writing nulls.
 */
import type { Assertion, AssertionResult, Run, RunVerification, Verdict } from './contract/types';
import { coverageHonesty } from './contract/circularity';
import { type Change, type N8nWorkflowDoc } from './graph/hash';
export interface AuditInput {
    readonly workflowId: string;
    readonly workflowName: string;
    readonly currentHash: string;
    readonly runs: readonly Run[];
    readonly assertions: readonly Assertion[];
    readonly now: Date;
    /** Calendar shape, so absence checks do not fire out of hours. */
    readonly cadenceShape?: {
        readonly weekdaysOnly?: boolean;
        readonly activeHours?: {
            readonly from: number;
            readonly to: number;
        };
    };
    /** When supplied alongside the previous revision, drift is explained. */
    readonly previousDoc?: N8nWorkflowDoc;
    readonly currentDoc?: N8nWorkflowDoc;
}
export interface Violation {
    readonly runId?: string;
    readonly at?: string;
    readonly result: AssertionResult;
}
export interface AuditResult {
    readonly workflowId: string;
    readonly workflowName: string;
    readonly runsExamined: number;
    readonly platformReportedFailures: number;
    readonly perRun: readonly RunVerification[];
    readonly cadence?: AssertionResult;
    readonly violations: readonly Violation[];
    /** How many runs had at least one violated assertion. */
    readonly runsWithViolations: number;
    /** Distinct assertions that were violated at least once. */
    readonly assertionsViolated: number;
    readonly counts: Readonly<Record<Verdict, number>>;
    readonly unprovenBreakdown: Readonly<Record<string, number>>;
    readonly honesty: ReturnType<typeof coverageHonesty>;
    readonly drift: readonly Change[];
    /** The single sentence a person should read first. */
    readonly headline: string;
}
export declare function audit(input: AuditInput): AuditResult;
