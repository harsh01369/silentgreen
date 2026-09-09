/**
 * Deciding when to actually tell somebody.
 *
 * The difference between an alerting system and a thing that shouts is entirely
 * in this file. A check that has been violated for nine days should not produce
 * nine days of identical messages, because the third one trains the reader to
 * filter the channel, and a filtered channel is worse than no alerting at all:
 * everyone believes they are covered.
 *
 * This is the same failure the product exists to catch, one level up. A muted
 * alert and a green tick nobody reads are the same defect.
 *
 * So:
 *   - notify when a check first starts failing
 *   - stay quiet while it keeps failing, and re-notify only after a long
 *     interval, so a long outage does not silently drop off the radar either
 *   - notify once when it recovers, because "it is fixed" is information
 *   - never notify about `unproven`, which is a coverage gap rather than an
 *     incident, and belongs in the review queue rather than in somebody's night
 *
 * Pure functions. No clock of their own, no I/O.
 */
import type { AssertionResult } from '../contract/types';
export interface AlertRecord {
    /** When this check first entered the failing state, and stayed there. */
    readonly firingSince: string;
    readonly lastNotifiedAt: string;
    readonly notifications: number;
    /** Kept so a recovery message can say what it was. */
    readonly lastDetail?: string;
}
export type AlertState = Readonly<Record<string, AlertRecord>>;
export type AlertAction = {
    readonly kind: 'opened';
    readonly assertionId: string;
    readonly result: AssertionResult;
} | {
    readonly kind: 'still-failing';
    readonly assertionId: string;
    readonly result: AssertionResult;
    readonly sinceHours: number;
} | {
    readonly kind: 'resolved';
    readonly assertionId: string;
    readonly statement: string;
    readonly wasFailingHours: number;
};
export interface AlertDecision {
    readonly actions: readonly AlertAction[];
    readonly state: AlertState;
}
/** How long to stay quiet about a check that is still failing. */
export declare const DEFAULT_REMINDER_HOURS = 24;
/**
 * Compare the current verdicts against what we have already said, and decide
 * what is worth saying now.
 *
 * `results` should be one entry per assertion, already reduced across runs: if
 * a check was violated in any run of this cycle, pass the violated result.
 */
export declare function decideAlerts(results: readonly AssertionResult[], previous: AlertState, now: Date, reminderHours?: number): AlertDecision;
/** Reduce many per-run results down to one verdict per assertion. */
export declare function worstPerAssertion(results: readonly AssertionResult[]): readonly AssertionResult[];
