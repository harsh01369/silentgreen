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

export type AlertAction =
  | { readonly kind: 'opened'; readonly assertionId: string; readonly result: AssertionResult }
  | { readonly kind: 'still-failing'; readonly assertionId: string; readonly result: AssertionResult; readonly sinceHours: number }
  | { readonly kind: 'resolved'; readonly assertionId: string; readonly statement: string; readonly wasFailingHours: number };

export interface AlertDecision {
  readonly actions: readonly AlertAction[];
  readonly state: AlertState;
}

/** How long to stay quiet about a check that is still failing. */
export const DEFAULT_REMINDER_HOURS = 24;

const HOUR_MS = 3_600_000;

/**
 * Compare the current verdicts against what we have already said, and decide
 * what is worth saying now.
 *
 * `results` should be one entry per assertion, already reduced across runs: if
 * a check was violated in any run of this cycle, pass the violated result.
 */
export function decideAlerts(
  results: readonly AssertionResult[],
  previous: AlertState,
  now: Date,
  reminderHours: number = DEFAULT_REMINDER_HOURS,
): AlertDecision {
  const actions: AlertAction[] = [];
  const next: Record<string, AlertRecord> = {};
  const seen = new Set<string>();

  for (const r of results) {
    seen.add(r.assertionId);
    const existing = previous[r.assertionId];

    if (r.verdict !== 'violated') {
      // `unproven` deliberately does not resolve an open alert either: we have
      // stopped being able to see the thing, which is not the same as it being
      // fixed, and quietly closing the incident would be a lie of omission.
      if (existing && r.verdict === 'proven') {
        actions.push({
          kind: 'resolved',
          assertionId: r.assertionId,
          statement: r.statement,
          wasFailingHours: hoursBetween(existing.firingSince, now),
        });
        continue; // dropped from state: no longer firing
      }
      if (existing) next[r.assertionId] = existing; // unproven: hold the incident open
      continue;
    }

    if (!existing) {
      actions.push({ kind: 'opened', assertionId: r.assertionId, result: r });
      next[r.assertionId] = {
        firingSince: now.toISOString(),
        lastNotifiedAt: now.toISOString(),
        notifications: 1,
        lastDetail: r.detail,
      };
      continue;
    }

    const sinceLast = (now.getTime() - Date.parse(existing.lastNotifiedAt)) / HOUR_MS;
    if (sinceLast >= reminderHours) {
      actions.push({
        kind: 'still-failing',
        assertionId: r.assertionId,
        result: r,
        sinceHours: hoursBetween(existing.firingSince, now),
      });
      next[r.assertionId] = {
        ...existing,
        lastNotifiedAt: now.toISOString(),
        notifications: existing.notifications + 1,
        lastDetail: r.detail,
      };
    } else {
      next[r.assertionId] = { ...existing, lastDetail: r.detail };
    }
  }

  // An assertion that disappeared entirely (retired, or its workflow removed)
  // keeps its record rather than silently resolving. Somebody deleting a check
  // is not the same as the underlying problem going away.
  for (const [id, rec] of Object.entries(previous)) {
    if (!seen.has(id) && !next[id]) next[id] = rec;
  }

  return { actions, state: next };
}

function hoursBetween(iso: string, now: Date): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now.getTime() - t) / HOUR_MS);
}

/** Reduce many per-run results down to one verdict per assertion. */
export function worstPerAssertion(results: readonly AssertionResult[]): readonly AssertionResult[] {
  const rank = { violated: 3, unproven: 2, proven: 1 } as const;
  const best = new Map<string, AssertionResult>();
  for (const r of results) {
    const cur = best.get(r.assertionId);
    if (!cur || rank[r.verdict] > rank[cur.verdict]) best.set(r.assertionId, r);
  }
  return [...best.values()];
}
