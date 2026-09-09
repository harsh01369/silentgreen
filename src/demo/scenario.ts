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

/** Small deterministic PRNG, so the demo is identical everywhere it runs. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_WORKFLOW_ID = 'wf_order_sync';

export function demoWorkflow(withRetryEdit = false): N8nWorkflowDoc {
  return {
    id: DEMO_WORKFLOW_ID,
    name: 'Shopify orders to Postgres and confirmation email',
    nodes: [
      {
        id: 'trg',
        name: 'Every hour',
        type: 'n8n-nodes-base.scheduleTrigger',
        typeVersion: 1.2,
        position: [0, 0],
        parameters: { rule: { interval: [{ field: 'hours', hoursInterval: 1 }] } },
      },
      {
        id: 'fetch',
        name: 'Fetch new orders',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [200, 0],
        parameters: withRetryEdit
          ? { method: 'GET', url: 'https://api.shop.example/v2/orders', retryOnFail: true, maxTries: 3 }
          : { method: 'GET', url: 'https://api.shop.example/v2/orders' },
      },
      {
        id: 'map',
        name: 'Map order fields',
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [400, 0],
        parameters: { mode: 'manual', fields: ['order_id', 'customer_email', 'total'] },
      },
      {
        id: 'db',
        name: 'Insert into orders',
        type: 'n8n-nodes-base.postgres',
        typeVersion: 2.5,
        position: [600, -100],
        parameters: { operation: 'insert', table: 'orders' },
        credentials: { postgres: { id: '3', name: 'prod db' } },
      },
      {
        id: 'mail',
        name: 'Send confirmation',
        type: 'n8n-nodes-base.gmail',
        typeVersion: 2.1,
        position: [600, 100],
        parameters: { operation: 'send', subject: 'Your order is confirmed' },
        credentials: { gmailOAuth2: { id: '7', name: 'orders@' } },
      },
    ],
    connections: {
      'Every hour': { main: [[{ node: 'Fetch new orders', type: 'main', index: 0 }]] },
      'Fetch new orders': { main: [[{ node: 'Map order fields', type: 'main', index: 0 }]] },
      'Map order fields': {
        main: [
          [
            { node: 'Insert into orders', type: 'main', index: 0 },
            { node: 'Send confirmation', type: 'main', index: 0 },
          ],
        ],
      },
    },
    settings: { executionOrder: 'v1' },
  };
}

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

const DAY_MS = 86_400_000;

/**
 * Six weeks of hourly weekday runs, every one of them recorded as a success.
 */
export function demoTimeline(seed = 20260909): DemoTimeline {
  const rand = mulberry32(seed);
  const runs: Run[] = [];

  const breakageDay = 22;
  const editDay = 27;
  const silenceDay = 31;
  const totalDays = 42;

  // Start on a Monday so the weekday rhythm is clean.
  const start = Date.UTC(2026, 6, 6, 0, 0, 0); // 2026-07-06 is a Monday

  for (let day = 0; day < totalDays; day++) {
    const dayStart = start + day * DAY_MS;
    const dow = new Date(dayStart).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (day >= silenceDay) continue; // deactivated, so nothing is written at all

    for (let hour = 9; hour <= 17; hour++) {
      const at = dayStart + hour * 3_600_000;
      const broken = day >= breakageDay;

      // Order volume varies the way real traffic does, and never collapses.
      const count = 40 + Math.floor(rand() * 21);
      const orders: unknown[] = [];
      const emails: unknown[] = [];

      for (let i = 0; i < count; i++) {
        const orderId = `ORD-${day}-${hour}-${i}`;
        const firstName = ['Priya', 'Tomas', 'Aiko', 'Sofia', 'Daniel'][Math.floor(rand() * 5)]!;
        const total = Math.round((20 + rand() * 180) * 100) / 100;

        orders.push({
          order_id: orderId,
          // The whole incident, in one field. Before the rename this carries an
          // address; after it, the mapping silently resolves to null and the
          // insert happily writes it.
          customer_email: broken ? null : `${firstName.toLowerCase()}@example.com`,
          total,
          synced_at: new Date(at).toISOString(),
        });

        emails.push({
          to: broken ? 'null' : `${firstName.toLowerCase()}@example.com`,
          subject: 'Your order is confirmed',
          // Once the upstream field is gone the expression never resolves, and
          // the template ships to a real customer exactly as written.
          body: broken
            ? 'Hi {{ $json.firstName }}, your order is confirmed. Total: {{ $json.total }}'
            : `Hi ${firstName}, your order is confirmed. Total: ${total.toFixed(2)}`,
          order_id: orderId,
        });
      }

      runs.push({
        id: `exec_${day}_${hour}`,
        workflowId: DEMO_WORKFLOW_ID,
        platform: 'n8n',
        startedAt: new Date(at).toISOString(),
        finishedAt: new Date(at + 4200).toISOString(),
        // This is the point of the entire exercise.
        platformStatus: 'success',
        sinkOutputs: { db: orders, mail: emails },
        triggerInput: orders.map((o) => ({ order_id: (o as { order_id: string }).order_id })),
      });
    }
  }

  return {
    runs,
    breakageDay,
    editDay,
    silenceDay,
    startedAt: new Date(start).toISOString(),
    now: new Date(start + totalDays * DAY_MS).toISOString(),
  };
}

/** What the platform itself would tell you about this period. */
export function platformSummary(t: DemoTimeline): {
  readonly executions: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly sentence: string;
} {
  const executions = t.runs.length;
  const failed = t.runs.filter((r) => r.platformStatus === 'error').length;
  return {
    executions,
    succeeded: executions - failed,
    failed,
    sentence: `${executions} executions, ${executions - failed} successful, ${failed} failed.`,
  };
}
