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

import type {
  Assertion,
  AssertionResult,
  Run,
  RunVerification,
  Verdict,
} from './contract/types';
import { evaluate } from './verify/assert';
import { evaluateCadence } from './verify/cadence';
import { coverageHonesty } from './contract/circularity';
import { diffWorkflows, type Change, type N8nWorkflowDoc } from './graph/hash';

export interface AuditInput {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly currentHash: string;
  readonly runs: readonly Run[];
  readonly assertions: readonly Assertion[];
  readonly now: Date;
  /** Calendar shape, so absence checks do not fire out of hours. */
  readonly cadenceShape?: { readonly weekdaysOnly?: boolean; readonly activeHours?: { readonly from: number; readonly to: number } };
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

function worst(results: readonly AssertionResult[]): Verdict {
  if (results.some((r) => r.verdict === 'violated')) return 'violated';
  if (results.some((r) => r.verdict === 'unproven')) return 'unproven';
  return 'proven';
}

export function audit(input: AuditInput): AuditResult {
  const live = input.assertions.filter((a) => a.status !== 'retired');
  const perRunAssertions = live.filter((a) => a.kind !== 'cadence');
  const cadenceAssertions = live.filter((a) => a.kind === 'cadence');

  const perRun: RunVerification[] = [];
  const violations: Violation[] = [];
  const counts: Record<Verdict, number> = { proven: 0, violated: 0, unproven: 0 };
  const unprovenBreakdown: Record<string, number> = {};
  const violatedAssertionIds = new Set<string>();
  let runsWithViolations = 0;

  for (const run of input.runs) {
    const results = perRunAssertions.map((a) => evaluate(a, run, { currentWorkflowHash: input.currentHash }));
    for (const r of results) {
      counts[r.verdict] += 1;
      if (r.verdict === 'unproven' && r.unprovenReason) {
        unprovenBreakdown[r.unprovenReason] = (unprovenBreakdown[r.unprovenReason] ?? 0) + 1;
      }
      if (r.verdict === 'violated') {
        violatedAssertionIds.add(r.assertionId);
        violations.push({ runId: run.id, at: run.startedAt, result: r });
      }
    }
    if (results.some((r) => r.verdict === 'violated')) runsWithViolations += 1;
    perRun.push({
      runId: run.id,
      workflowId: run.workflowId,
      evaluatedAt: input.now.toISOString(),
      results,
      summary: worst(results),
    });
  }

  let cadence: AssertionResult | undefined;
  for (const a of cadenceAssertions) {
    const r = evaluateCadence(a, input.runs, {
      now: input.now,
      weekdaysOnly: input.cadenceShape?.weekdaysOnly,
      activeHours: input.cadenceShape?.activeHours,
      currentWorkflowHash: input.currentHash,
    });
    counts[r.verdict] += 1;
    if (r.verdict === 'unproven' && r.unprovenReason) {
      unprovenBreakdown[r.unprovenReason] = (unprovenBreakdown[r.unprovenReason] ?? 0) + 1;
    }
    if (r.verdict === 'violated') {
      violatedAssertionIds.add(r.assertionId);
      violations.push({ result: r });
    }
    // Only one cadence statement is meaningful per workflow; the last wins.
    cadence = r;
  }

  const drift =
    input.previousDoc && input.currentDoc ? diffWorkflows(input.previousDoc, input.currentDoc) : [];

  const platformReportedFailures = input.runs.filter((r) => r.platformStatus === 'error').length;
  const honesty = coverageHonesty(input.assertions);

  return {
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    runsExamined: input.runs.length,
    platformReportedFailures,
    perRun,
    cadence,
    violations,
    runsWithViolations,
    assertionsViolated: violatedAssertionIds.size,
    counts,
    unprovenBreakdown,
    honesty,
    drift,
    headline: headlineFor({
      runs: input.runs.length,
      platformReportedFailures,
      runsWithViolations,
      counts,
      cadenceViolated: cadence?.verdict === 'violated',
      liveChecks: honesty.live,
    }),
  };
}

function headlineFor(a: {
  runs: number;
  platformReportedFailures: number;
  runsWithViolations: number;
  counts: Record<Verdict, number>;
  cadenceViolated: boolean;
  liveChecks: number;
}): string {
  if (a.liveChecks === 0) {
    return `Nothing is being verified on this workflow. ${a.runs} runs were examined and none of them was checked against anything, so the ${a.runs - a.platformReportedFailures} successes mean only that code ran without throwing.`;
  }
  if (a.cadenceViolated && a.runsWithViolations === 0) {
    return `This workflow has stopped running. Nothing has failed, because nothing has been attempted, which is why no error appears anywhere.`;
  }
  if (a.runsWithViolations === 0 && a.counts.violated === 0) {
    const caveat = a.counts.unproven > 0 ? ` ${a.counts.unproven} checks could not be established and are listed below.` : '';
    return `${a.runs} runs examined, ${a.counts.proven} checks held.${caveat}`;
  }
  const pct = Math.round((a.runsWithViolations / Math.max(1, a.runs)) * 100);
  return `${a.runsWithViolations} of ${a.runs} runs (${pct}%) produced output that violated a confirmed expectation, while the platform recorded ${a.platformReportedFailures} failures.`;
}
