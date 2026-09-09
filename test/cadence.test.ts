import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { inferCadence, evaluateCadence, humanise } from '../src/verify/cadence';
import type { Assertion, Run } from '../src/contract/types';

const HASH = 'e'.repeat(64);

function runsEvery(hours: number, count: number, from = Date.UTC(2026, 8, 1, 0, 0, 0)): Run[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `run_${i}`,
    workflowId: 'wf_1',
    platform: 'n8n' as const,
    startedAt: new Date(from + i * hours * 3600_000).toISOString(),
    platformStatus: 'success' as const,
    sinkOutputs: {},
  }));
}

/** Hourly, 09:00 to 17:00, weekdays only. The classic false-alarm generator. */
function weekdayBusinessHoursRuns(weeks: number): Run[] {
  const out: Run[] = [];
  // 2026-09-07 is a Monday.
  let day = Date.UTC(2026, 8, 7, 0, 0, 0);
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 5; d++) {
      for (let h = 9; h <= 17; h++) {
        out.push({
          id: `r_${w}_${d}_${h}`,
          workflowId: 'wf_1',
          platform: 'n8n',
          startedAt: new Date(day + d * 86400_000 + h * 3600_000).toISOString(),
          platformStatus: 'success',
          sinkOutputs: {},
        });
      }
    }
    day += 7 * 86400_000;
  }
  return out;
}

function cadenceAssertion(expectEverySeconds: number, graceSeconds: number, over: Partial<Assertion> = {}): Assertion {
  return {
    id: 'as_cad',
    workflowId: 'wf_1',
    sinkId: '*',
    kind: 'cadence',
    basis: 'observation',
    statement: 'This workflow runs at least hourly on weekdays',
    params: { kind: 'cadence', expectEverySeconds, graceSeconds },
    status: 'confirmed',
    confirmation: {
      by: 'h',
      at: '2026-09-01T00:00:00.000Z',
      workflowHash: HASH,
      evidenceRunIds: ['r1'],
      baselineAttestation: { windowStart: '2026-08-01T00:00:00.000Z', windowEnd: '2026-08-31T00:00:00.000Z', howKnown: 'Checked the schedule against the client runbook' },
    },
    createdAt: '2026-09-01T00:00:00.000Z',
    ...over,
  };
}

describe('learning a rhythm', () => {
  test('too few runs yields no profile rather than a guess', () => {
    assert.equal(inferCadence(runsEvery(1, 3)), null);
  });

  test('a tight hourly schedule is learned with high confidence', () => {
    const p = inferCadence(runsEvery(1, 40));
    assert.ok(p);
    assert.equal(p.medianIntervalSeconds, 3600);
    assert.equal(p.confidence, 'high');
  });

  test('an irregular event-driven trigger is flagged low confidence, not dressed up as a schedule', () => {
    const irregular: Run[] = [0, 0.2, 3, 3.1, 14, 27, 27.5, 90].map((h, i) => ({
      id: `r${i}`,
      workflowId: 'wf_1',
      platform: 'n8n' as const,
      startedAt: new Date(Date.UTC(2026, 8, 1) + h * 3600_000).toISOString(),
      platformStatus: 'success' as const,
      sinkOutputs: {},
    }));
    const p = inferCadence(irregular);
    assert.ok(p);
    assert.equal(p.confidence, 'low');
    assert.match(p.reasoning, /event driven/);
  });

  test('a weekday-only workflow is recognised and weekend gaps excluded from the rhythm', () => {
    const p = inferCadence(weekdayBusinessHoursRuns(3));
    assert.ok(p);
    assert.equal(p.weekdaysOnly, true);
    assert.match(p.reasoning, /No run has ever started at a weekend/);
    // Without the weekend exclusion the p95 would be pulled towards the 64h
    // Friday-to-Monday gap, which is precisely how these alerts get muted.
    assert.ok(
      p.p95IntervalSeconds < 20 * 3600,
      `p95 should reflect the working rhythm, got ${humanise(p.p95IntervalSeconds)}`,
    );
  });

  test('active hours are detected for a bounded working window', () => {
    const p = inferCadence(weekdayBusinessHoursRuns(3));
    assert.ok(p?.activeHours);
    assert.equal(p.activeHours.from, 9);
    assert.equal(p.activeHours.to, 17);
  });
});

describe('detecting the workflow that stopped', () => {
  test('a silent workflow is a violation even though no run failed', () => {
    const runs = runsEvery(1, 10, Date.UTC(2026, 8, 1, 0, 0, 0));
    const r = evaluateCadence(cadenceAssertion(3600, 1800), runs, { now: new Date(Date.UTC(2026, 8, 2, 0, 0, 0)) });
    assert.equal(r.verdict, 'violated');
    assert.match(r.detail ?? '', /Nothing has failed, because nothing has run/);
  });

  test('a workflow inside its window is proven', () => {
    const runs = runsEvery(1, 10, Date.UTC(2026, 8, 1, 0, 0, 0));
    // Last run is at 09:00; now is 09:40, inside 1h + 30m grace.
    const r = evaluateCadence(cadenceAssertion(3600, 1800), runs, { now: new Date(Date.UTC(2026, 8, 1, 9, 40, 0)) });
    assert.equal(r.verdict, 'proven');
  });

  test('a weekend does not page anyone for a weekday-only workflow', () => {
    const runs = weekdayBusinessHoursRuns(2);
    const last = Date.parse(runs[runs.length - 1]!.startedAt); // Friday 17:00
    // Sunday 18:00, about 49 hours later, all of it weekend.
    const now = new Date(last + 49 * 3600_000);
    const r = evaluateCadence(cadenceAssertion(3600, 3600), runs, { now, weekdaysOnly: true, activeHours: { from: 9, to: 17 } });
    assert.equal(r.verdict, 'proven', 'weekend silence on a weekday-only workflow is structure, not an incident');
  });

  test('the same silence on a workflow that should run at weekends is a violation', () => {
    const runs = weekdayBusinessHoursRuns(2);
    const last = Date.parse(runs[runs.length - 1]!.startedAt);
    const now = new Date(last + 49 * 3600_000);
    const r = evaluateCadence(cadenceAssertion(3600, 3600), runs, { now, weekdaysOnly: false });
    assert.equal(r.verdict, 'violated');
  });

  test('Monday morning silence is caught even under the weekend discount', () => {
    const runs = weekdayBusinessHoursRuns(2);
    const last = Date.parse(runs[runs.length - 1]!.startedAt); // Friday 17:00
    // Monday 15:00: roughly 70 hours later, of which 48 are weekend, leaving
    // about 22 working hours of silence. That is a real outage.
    const now = new Date(last + 70 * 3600_000);
    const r = evaluateCadence(cadenceAssertion(3600, 3600), runs, { now, weekdaysOnly: true, activeHours: { from: 9, to: 17 } });
    assert.equal(r.verdict, 'violated');
    assert.match(r.detail ?? '', /hours it never runs in are discounted/);
  });

  test('never having run is unproven, not a violation', () => {
    const r = evaluateCadence(cadenceAssertion(3600, 1800), [], { now: new Date() });
    assert.equal(r.verdict, 'unproven');
    assert.equal(r.unprovenReason, 'run-data-unavailable');
    // "We have never seen it run" and "it stopped running" are different
    // claims, and conflating them is how a tool loses trust on day one.
  });

  test('an unconfirmed cadence assertion raises nothing', () => {
    const runs = runsEvery(1, 10, Date.UTC(2026, 8, 1, 0, 0, 0));
    const r = evaluateCadence(cadenceAssertion(3600, 1800, { status: 'proposed' }), runs, {
      now: new Date(Date.UTC(2026, 8, 5, 0, 0, 0)),
    });
    assert.equal(r.verdict, 'unproven');
  });
});

describe('humanise', () => {
  test('reads the way a person would say it', () => {
    assert.equal(humanise(45), '45s');
    assert.equal(humanise(3600), '60 min');
    assert.equal(humanise(7200), '2.0h');
    assert.equal(humanise(86400 * 3), '3.0 days');
  });
});

describe('a cadence expectation is bound to a revision like any other', () => {
  test('a schedule confirmed against one graph says nothing about a rewired one', () => {
    const runs = runsEvery(1, 10, Date.UTC(2026, 8, 1, 0, 0, 0));
    const r = evaluateCadence(cadenceAssertion(3600, 1800), runs, {
      now: new Date(Date.UTC(2026, 8, 9, 0, 0, 0)),
      currentWorkflowHash: 'f'.repeat(64),
    });
    assert.equal(r.verdict, 'unproven');
    assert.equal(r.unprovenReason, 'contract-stale');
  });

  test('the same check still fires when the revision matches', () => {
    const runs = runsEvery(1, 10, Date.UTC(2026, 8, 1, 0, 0, 0));
    const r = evaluateCadence(cadenceAssertion(3600, 1800), runs, {
      now: new Date(Date.UTC(2026, 8, 9, 0, 0, 0)),
      currentWorkflowHash: HASH,
    });
    assert.equal(r.verdict, 'violated');
  });
});
