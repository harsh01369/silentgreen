/**
 * Evaluating a confirmed assertion against a captured run.
 *
 * Two rules govern everything here.
 *
 * First, only a confirmed, non-stale assertion can produce `proven` or
 * `violated`. Everything else is `unproven` with a reason. There is no code
 * path that turns silence into a pass.
 *
 * Second, `violated` must always carry the literal captured value that decided
 * it. If we cannot show the evidence, we do not make the accusation, because
 * telling an agency their client's automation is broken when it is not costs
 * more than the miss. Missing a defect leaves them where they already were.
 * Inventing one makes us the problem.
 */
import type { Assertion, AssertionResult, DegeneratePattern, Run } from '../contract/types';
/** Resolve a dot path such as "customer.email" against an item. */
export declare function fieldValue(item: unknown, path: string): {
    found: boolean;
    value: unknown;
};
/**
 * Does this value show a specific degenerate pattern?
 * Only strings are considered; a real null is a shape problem, not a text one.
 */
export declare function matchDegenerate(value: unknown, pattern: DegeneratePattern): boolean;
export declare function describeDegenerate(pattern: DegeneratePattern): string;
export interface EvaluateContext {
    /** The workflow revision the run executed against, if the platform reports it. */
    readonly currentWorkflowHash?: string;
}
/**
 * Evaluate one assertion against one run.
 *
 * `cadence` is deliberately not handled here: it is a statement about runs that
 * did not happen, so it cannot be answered by looking at a run that did. See
 * evaluateCadence in ./cadence.
 */
export declare function evaluate(assertion: Assertion, run: Run, ctx?: EvaluateContext): AssertionResult;
export declare function testPredicate(value: unknown, op: string, expected: string | number): boolean;
