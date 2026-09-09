import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { decideAlerts, worstPerAssertion, DEFAULT_REMINDER_HOURS, type AlertState } from '../src/alert/state';
import { renderText, channelsFromEnv, send } from '../src/alert/notify';
import type { AssertionResult } from '../src/contract/types';

function result(over: Partial<AssertionResult> = {}): AssertionResult {
  return {
    assertionId: 'as_1',
    verdict: 'violated',
    statement: '"Insert into orders" produces at least one item on every run',
    basis: 'structure',
    detail: 'The step produced no items.',
    evidence: '[]',
    ...over,
  };
}

const T0 = new Date('2026-09-01T09:00:00.000Z');
const hoursLater = (h: number) => new Date(T0.getTime() + h * 3_600_000);

describe('alerting once, not endlessly', () => {
  test('a new failure opens an alert', () => {
    const { actions, state } = decideAlerts([result()], {}, T0);
    assert.equal(actions.length, 1);
    assert.equal(actions[0]!.kind, 'opened');
    assert.ok(state.as_1);
    assert.equal(state.as_1.notifications, 1);
  });

  test('the same failure an hour later says nothing', () => {
    const first = decideAlerts([result()], {}, T0);
    const second = decideAlerts([result()], first.state, hoursLater(1));
    assert.equal(second.actions.length, 0, 'a failure that is already known is not news');
  });

  test('a long outage is re-raised, but only after the reminder window', () => {
    const first = decideAlerts([result()], {}, T0);
    const quiet = decideAlerts([result()], first.state, hoursLater(DEFAULT_REMINDER_HOURS - 1));
    assert.equal(quiet.actions.length, 0);

    const reminder = decideAlerts([result()], quiet.state, hoursLater(DEFAULT_REMINDER_HOURS + 1));
    assert.equal(reminder.actions.length, 1);
    assert.equal(reminder.actions[0]!.kind, 'still-failing');
    assert.equal(reminder.state.as_1!.notifications, 2);
  });

  test('recovery is reported once, then forgotten', () => {
    const first = decideAlerts([result()], {}, T0);
    const fixed = decideAlerts([result({ verdict: 'proven', detail: undefined })], first.state, hoursLater(3));
    assert.equal(fixed.actions.length, 1);
    assert.equal(fixed.actions[0]!.kind, 'resolved');
    assert.equal(fixed.state.as_1, undefined, 'the incident is closed');

    const after = decideAlerts([result({ verdict: 'proven' })], fixed.state, hoursLater(4));
    assert.equal(after.actions.length, 0, 'a healthy check is not an event');
  });

  test('a recovery message says how long it was failing', () => {
    const first = decideAlerts([result()], {}, T0);
    const fixed = decideAlerts([result({ verdict: 'proven' })], first.state, hoursLater(5));
    const a = fixed.actions[0]!;
    assert.equal(a.kind, 'resolved');
    if (a.kind === 'resolved') assert.ok(Math.abs(a.wasFailingHours - 5) < 0.01);
  });
});

describe('unproven is a coverage gap, not an incident', () => {
  test('an unproven check never opens an alert', () => {
    const { actions, state } = decideAlerts(
      [result({ verdict: 'unproven', unprovenReason: 'contract-stale', detail: undefined, evidence: undefined })],
      {},
      T0,
    );
    assert.equal(actions.length, 0, 'nobody should be paged because a check went stale');
    assert.deepEqual(state, {});
  });

  test('going unproven does not silently close an open incident', () => {
    const first = decideAlerts([result()], {}, T0);
    const blind = decideAlerts([result({ verdict: 'unproven', unprovenReason: 'sink-not-captured' })], first.state, hoursLater(2));
    assert.equal(blind.actions.length, 0, 'losing sight of a problem is not the same as fixing it');
    assert.ok(blind.state.as_1, 'the incident stays open');
  });

  test('a retired or vanished check keeps its open incident rather than resolving itself', () => {
    const first = decideAlerts([result()], {}, T0);
    const gone = decideAlerts([], first.state, hoursLater(2));
    assert.equal(gone.actions.length, 0);
    assert.ok(gone.state.as_1, 'deleting the check is not the same as fixing the problem');
  });
});

describe('reducing many runs to one verdict', () => {
  test('one violation among many passes wins', () => {
    const worst = worstPerAssertion([
      result({ verdict: 'proven' }),
      result({ verdict: 'proven' }),
      result({ verdict: 'violated' }),
      result({ verdict: 'proven' }),
    ]);
    assert.equal(worst.length, 1);
    assert.equal(worst[0]!.verdict, 'violated');
  });

  test('unproven outranks proven, because a gap is not a pass', () => {
    const worst = worstPerAssertion([result({ verdict: 'proven' }), result({ verdict: 'unproven' })]);
    assert.equal(worst[0]!.verdict, 'unproven');
  });
});

describe('what the message says', () => {
  test('an opened alert carries the statement, the detail and the captured value', () => {
    const { actions } = decideAlerts([result()], {}, T0);
    const text = renderText(actions[0]!, { workflowName: 'Order sync', clientName: 'Fernweh Supply' });
    assert.match(text, /Fernweh Supply \/ Order sync/);
    assert.match(text, /produces at least one item/);
    assert.match(text, /The step produced no items/);
    assert.match(text, /Captured: \[\]/);
  });

  test('the basis is stated, so a reader knows what the alert is worth', () => {
    const { actions } = decideAlerts([result({ basis: 'observation' })], {}, T0);
    const text = renderText(actions[0]!, { workflowName: 'Order sync' });
    assert.match(text, /learned from history against an attested baseline/);
  });

  test('a recovery reads as a recovery', () => {
    const first = decideAlerts([result()], {}, T0);
    const fixed = decideAlerts([result({ verdict: 'proven' })], first.state, hoursLater(6));
    const text = renderText(fixed.actions[0]!, { workflowName: 'Order sync' });
    assert.match(text, /^Recovered/);
  });
});

describe('channels', () => {
  test('none configured means none, rather than a default nobody reads', () => {
    assert.deepEqual(channelsFromEnv({} as NodeJS.ProcessEnv), []);
  });

  test('each webhook variable produces its own channel', () => {
    const channels = channelsFromEnv({
      SILENTGREEN_SLACK_WEBHOOK: 'https://hooks.slack.example/x',
      SILENTGREEN_WEBHOOK: 'https://ops.example/hook',
    } as NodeJS.ProcessEnv);
    assert.deepEqual(channels.map((c) => c.kind), ['slack', 'webhook']);
  });

  test('a failed delivery is reported rather than swallowed', async () => {
    const failing: typeof fetch = async () => new Response('nope', { status: 404 });
    const { actions } = decideAlerts([result()], {}, T0);
    const out = await send(
      [{ kind: 'slack', url: 'https://hooks.slack.example/gone' }],
      actions[0]!,
      { workflowName: 'Order sync' },
      { fetchImpl: failing },
    );
    assert.equal(out[0]!.ok, false);
    assert.equal(out[0]!.status, 404);
    // A rotated webhook that now 404s must not leave us claiming somebody was told.
  });

  test('a network error is reported rather than thrown', async () => {
    const boom: typeof fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND hooks.slack.example');
    };
    const { actions } = decideAlerts([result()], {}, T0);
    const out = await send([{ kind: 'slack', url: 'https://x' }], actions[0]!, { workflowName: 'W' }, { fetchImpl: boom });
    assert.equal(out[0]!.ok, false);
    assert.match(out[0]!.error ?? '', /ENOTFOUND/);
  });

  test('discord payloads stay under the hard 2000 character limit', async () => {
    let body = '';
    const capture: typeof fetch = async (_url, init) => {
      body = String(init?.body ?? '');
      return new Response('ok', { status: 200 });
    };
    const long = 'x'.repeat(5000);
    const { actions } = decideAlerts([result({ evidence: long, detail: long })], {}, T0);
    await send([{ kind: 'discord', url: 'https://d' }], actions[0]!, { workflowName: 'W' }, { fetchImpl: capture });
    const parsed = JSON.parse(body) as { content: string };
    assert.ok(parsed.content.length <= 1900, `discord rejects over 2000, got ${parsed.content.length}`);
  });
});

describe('state shape', () => {
  test('an empty previous state is valid input', () => {
    const empty: AlertState = {};
    assert.doesNotThrow(() => decideAlerts([], empty, T0));
  });
});
