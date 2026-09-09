/**
 * A worked example, generated deterministically.
 *
 * This is not a toy. It reproduces the incident a practitioner described in the
 * n8n community thread that started this project:
 *
 *   "An external webhook returned HTTP 200 but upstream API payload changes
 *    caused silent downstream mapping failures, leaving hundreds of data syncs
 *    unprocessed for 3 days."
 *
 * The scenario is a Shopify-to-Postgres order sync with a customer confirmation
 * email. It runs hourly on weekdays. Over six weeks, four separate things go
 * wrong, and the platform records every single run as a success:
 *
 *   1. Day 22  The upstream API renames `customer_email` to `customerEmail`.
 *              The mapping step now emits null. Rows keep being written, with
 *              a null where the email should be. Volume is unchanged, so a
 *              baseline monitor sees nothing at all.
 *
 *   2. Day 22  The same rename breaks the email template, so customers receive
 *              "Hi {{ $json.firstName }}". The send succeeds.
 *
 *   3. Day 27  Someone edits the workflow to add a retry. Any check bound to
 *              the old revision no longer describes what runs. This is included
 *              because the honest answer there is "unproven", not a green tick,
 *              and a demo that only shows catches is a sales pitch.
 *
 *   4. Day 31  The workflow is deactivated during an unrelated incident and
 *              never reactivated. It writes no executions at all from here on,
 *              so there is nothing for an event-driven monitor to react to.
 *
 * Everything below is derived from a seed, so the numbers in the README, the
 * tests and the landing page are the same numbers.
 */
import type { Run } from '../contract/types';
import type { N8nWorkflowDoc } from '../graph/hash';
export declare const DEMO_WORKFLOW_ID = "wf_order_sync";
export declare function demoWorkflow(withRetryEdit?: boolean): N8nWorkflowDoc;
export interface DemoTimeline {
    readonly runs: readonly Run[];
    /** The day the upstream rename lands. */
    readonly breakageDay: number;
    /** The day the workflow was edited, invalidating contracts. */
    readonly editDay: number;
    /** The day it stopped running entirely. */
    readonly silenceDay: number;
    readonly startedAt: string;
    readonly now: string;
}
/**
 * Six weeks of hourly weekday runs, every one of them recorded as a success.
 */
export declare function demoTimeline(seed?: number): DemoTimeline;
/** What the platform itself would tell you about this period. */
export declare function platformSummary(t: DemoTimeline): {
    readonly executions: number;
    readonly succeeded: number;
    readonly failed: number;
    readonly sentence: string;
};
