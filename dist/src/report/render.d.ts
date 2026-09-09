/**
 * The client evidence report.
 *
 * This is the commercial artefact. The engineering exists so that this document
 * can be handed to somebody who is deciding whether to keep paying, and be true.
 *
 * Two rules shape it.
 *
 * It leads with what could not be established, not with what passed. Any report
 * that opens with a wall of green trains its reader to skim, and a reader who
 * skims cannot tell the difference between "we checked forty things" and "we
 * checked nothing and found no problems".
 *
 * It never converts an absence of findings into a claim of correctness. The
 * coverage sentence at the top says, in plain English, what this month's checks
 * are capable of proving, which for most workflows is "it has not changed"
 * rather than "it is right".
 */
import type { Assertion, AssertionResult } from '../contract/types';
import type { AuditResult } from '../audit';
import type { Ledger } from '../ledger/chain';
export interface ReportInput {
    readonly result: AuditResult;
    readonly assertions: readonly Assertion[];
    readonly ledger: Ledger;
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly clientName: string;
    readonly preparedBy: string;
    readonly platform: {
        readonly executions: number;
        readonly succeeded: number;
        readonly failed: number;
        readonly sentence: string;
    };
}
export declare function renderReport(input: ReportInput): string;
/** Convenience for tests: the plain-text spine of the report. */
export declare function reportSummaryLines(result: AuditResult): readonly string[];
export type { AssertionResult };
