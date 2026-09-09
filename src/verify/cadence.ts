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

const HOUR = 3600;
const MINIMUM_RUNS_TO_INFER = 6;

export interface CadenceProfile {
  /** Typical gap between runs, in seconds, robust to outliers. */
  readonly medianIntervalSeconds: number;
  /** Gap we would be surprised to exceed, in seconds. */
  readonly p95IntervalSeconds: number;
  /** True when no run has ever started on a Saturday or Sunday. */
  readonly weekdaysOnly: boolean;
  /** Local hours during which runs occur, when clearly bounded. */
  readonly activeHours?: { readonly from: number; readonly to: number };
  readonly sampleSize: number;
  /**
   * How much to trust this. Low confidence profiles are still worth proposing,
   * but they must be confirmed by a human before they can raise anything.
   */
  readonly confidence: 'low' | 'moderate' | 'high';
  /** Written for the person deciding whether to confirm it. */
  readonly reasoning: string;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
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
export function inferCadence(runs: readonly Run[]): CadenceProfile | null {
  const starts = runs
    .map((r) => Date.parse(r.startedAt))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);

  if (starts.length < MINIMUM_RUNS_TO_INFER) return null;

  const weekdaysOnly = !starts.some((t) => {
    const d = new Date(t).getUTCDay();
    return d === 0 || d === 6;
  });

  // The working shape has to be established before the rhythm, because it
  // decides which gaps are incidents and which are simply closing time.
  const hours = starts.map((t) => new Date(t).getUTCHours());
  const minHour = Math.min(...hours);
  const maxHour = Math.max(...hours);
  const activeHours = maxHour - minHour <= 14 && starts.length >= 10 ? { from: minHour, to: maxHour } : undefined;
  const shape = { weekdaysOnly, activeHours };

  const allIntervals: number[] = [];
  const workingIntervals: number[] = [];
  for (let i = 1; i < starts.length; i++) {
    const gap = (starts[i]! - starts[i - 1]!) / 1000;
    if (gap <= 0) continue;
    allIntervals.push(gap);
    // A gap that crosses a weekend or a night is structure, not rhythm. Leaving
    // those in is what produces an expectation like "runs at least every 16
    // hours" for a workflow that actually runs every hour, and an expectation
    // that loose will not notice a full day of silence.
    if (nonWorkingSeconds(starts[i - 1]!, starts[i]!, shape) === 0) workingIntervals.push(gap);
  }
  if (allIntervals.length === 0) return null;

  const excludedStructuralGaps = allIntervals.length - workingIntervals.length;
  const basis = workingIntervals.length >= 3 ? workingIntervals : allIntervals;
  const sorted = [...basis].sort((a, b) => a - b);

  const median = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);

  // Dispersion tells us whether this is a schedule or a webhook. A schedule is
  // tight; a webhook driven by human behaviour is not, and we should not
  // pretend to predict it.
  const spread = median > 0 ? p95 / median : Infinity;
  let confidence: CadenceProfile['confidence'];
  let reasoning: string;
  if (sorted.length >= 20 && spread <= 1.5) {
    confidence = 'high';
    reasoning = `${sorted.length} intervals, tightly clustered around ${humanise(median)}. This looks like a schedule, and a missed run should be obvious quickly.`;
  } else if (sorted.length >= 10 && spread <= 4) {
    confidence = 'moderate';
    reasoning = `${sorted.length} intervals with a typical gap of ${humanise(median)} and a long tail out to ${humanise(p95)}. Usable, but expect the occasional legitimate late run.`;
  } else {
    confidence = 'low';
    reasoning = `Only ${sorted.length} intervals, ranging widely (typical ${humanise(median)}, tail ${humanise(p95)}). This is probably event driven rather than scheduled, so an absence alarm here will be noisy. Consider a volume expectation over a day instead.`;
  }

  if (weekdaysOnly) {
    reasoning += ' No run has ever started at a weekend, so weekend gaps are excluded from the rhythm rather than treated as incidents.';
  }
  if (activeHours) {
    reasoning += ` Runs only ever start between ${String(activeHours.from).padStart(2, '0')}:00 and ${String(activeHours.to).padStart(2, '0')}:59, so overnight silence is expected too.`;
  }
  if (excludedStructuralGaps > 0) {
    reasoning += ` ${excludedStructuralGaps} gap(s) that crossed non-working time were excluded from the calculation, which is what keeps the expectation tight enough to be useful.`;
  }

  return {
    medianIntervalSeconds: Math.round(median),
    p95IntervalSeconds: Math.round(p95),
    weekdaysOnly,
    activeHours,
    sampleSize: sorted.length,
    confidence,
    reasoning,
  };
}

/**
 * How much of the gap between two instants is time the workflow was never
 * expected to run in?
 *
 * Weekends are the obvious case, but they are not the whole of it. A workflow
 * that runs 09:00 to 17:00 has a sixteen hour gap every single night, and a
 * checker that only discounts weekends will page someone at 02:00 on a Tuesday
 * for a workflow that is behaving perfectly. That alert gets muted, and a muted
 * alert is worse than no alert because it is believed to be working.
 */
function nonWorkingSeconds(
  fromMs: number,
  toMs: number,
  shape: { readonly weekdaysOnly?: boolean; readonly activeHours?: { readonly from: number; readonly to: number } },
): number {
  if (!shape.weekdaysOnly && !shape.activeHours) return 0;
  let acc = 0;
  const STEP = 15 * 60 * 1000;
  for (let t = fromMs; t < toMs; t += STEP) {
    const d = new Date(t);
    const day = d.getUTCDay();
    const hour = d.getUTCHours();
    const offDay = shape.weekdaysOnly === true && (day === 0 || day === 6);
    const offHour = shape.activeHours ? hour < shape.activeHours.from || hour > shape.activeHours.to : false;
    if (offDay || offHour) acc += STEP / 1000;
  }
  return acc;
}

export interface CadenceContext {
  readonly now: Date;
  /** Set when the profile that produced this assertion knew about weekends. */
  readonly weekdaysOnly?: boolean;
  /**
   * The hours of the day this workflow actually works, inclusive. Silence
   * outside them is expected rather than suspicious.
   */
  readonly activeHours?: { readonly from: number; readonly to: number };
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
export function evaluateCadence(
  assertion: Assertion,
  runs: readonly Run[],
  ctx: CadenceContext,
): AssertionResult {
  const base = {
    assertionId: assertion.id,
    statement: assertion.statement,
    basis: assertion.basis,
  };

  if (assertion.status !== 'confirmed') {
    return { ...base, verdict: 'unproven', unprovenReason: assertion.status === 'stale' ? 'contract-stale' : 'only-proposed-assertions' };
  }
  if (assertion.params.kind !== 'cadence') {
    return { ...base, verdict: 'unproven', unprovenReason: 'assertion-not-applicable' };
  }
  if (
    ctx.currentWorkflowHash &&
    assertion.confirmation &&
    assertion.confirmation.workflowHash !== ctx.currentWorkflowHash
  ) {
    return { ...base, verdict: 'unproven', unprovenReason: 'contract-stale' };
  }

  const starts = runs
    .map((r) => Date.parse(r.startedAt))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a);

  if (starts.length === 0) {
    return { ...base, verdict: 'unproven', unprovenReason: 'run-data-unavailable' };
  }

  const last = starts[0]!;
  const nowMs = ctx.now.getTime();
  const rawSilence = (nowMs - last) / 1000;
  const discounted = rawSilence - nonWorkingSeconds(last, nowMs, { weekdaysOnly: ctx.weekdaysOnly, activeHours: ctx.activeHours });
  const allowance = assertion.params.expectEverySeconds + assertion.params.graceSeconds;

  if (discounted > allowance) {
    const detail =
      rawSilence !== discounted
        ? `Last run was ${humanise(rawSilence)} ago (${humanise(discounted)} of working time, once hours it never runs in are discounted). Expected one every ${humanise(assertion.params.expectEverySeconds)} with ${humanise(assertion.params.graceSeconds)} of grace. Nothing has failed, because nothing has run.`
        : `Last run was ${humanise(rawSilence)} ago. Expected one every ${humanise(assertion.params.expectEverySeconds)} with ${humanise(assertion.params.graceSeconds)} of grace. Nothing has failed, because nothing has run.`;
    return {
      ...base,
      verdict: 'violated',
      detail,
      evidence: new Date(last).toISOString(),
    };
  }

  return { ...base, verdict: 'proven', evidence: `last run ${new Date(last).toISOString()}` };
}

export function humanise(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = s / 3600;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  const d = s / 86400;
  return `${d.toFixed(d < 10 ? 1 : 0)} days`;
}
