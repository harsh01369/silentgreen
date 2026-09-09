/**
 * Delivering an alert.
 *
 * Every channel here is an HTTPS POST, which keeps the package dependency-free
 * and means the whole thing still runs inside a locked-down network with one
 * outbound host allowed.
 *
 * One rule specific to this product: a notifier that fails silently is the
 * exact defect we exist to catch, one level up. If Slack returns a 404 because
 * somebody rotated the webhook three months ago, the tool must not carry on
 * reporting that it alerted. Every delivery failure is returned, printed and
 * written to the evidence ledger, and `watch` says plainly on startup when no
 * channel is configured at all rather than implying somebody is being told.
 */

import type { AlertAction } from './state';

export type ChannelKind = 'slack' | 'discord' | 'teams' | 'webhook';

export interface Channel {
  readonly kind: ChannelKind;
  readonly url: string;
}

export interface DeliveryResult {
  readonly channel: ChannelKind;
  readonly ok: boolean;
  readonly status?: number;
  readonly error?: string;
}

/**
 * Read channels from the environment.
 *
 * Deliberately env-only: webhook URLs are credentials, and writing them into a
 * state file that people are encouraged to commit would be a poor idea from a
 * tool that lectures about rigour.
 */
export function channelsFromEnv(env: NodeJS.ProcessEnv = process.env): readonly Channel[] {
  const out: Channel[] = [];
  if (env.SILENTGREEN_SLACK_WEBHOOK) out.push({ kind: 'slack', url: env.SILENTGREEN_SLACK_WEBHOOK });
  if (env.SILENTGREEN_DISCORD_WEBHOOK) out.push({ kind: 'discord', url: env.SILENTGREEN_DISCORD_WEBHOOK });
  if (env.SILENTGREEN_TEAMS_WEBHOOK) out.push({ kind: 'teams', url: env.SILENTGREEN_TEAMS_WEBHOOK });
  if (env.SILENTGREEN_WEBHOOK) out.push({ kind: 'webhook', url: env.SILENTGREEN_WEBHOOK });
  return out;
}

export interface MessageContext {
  readonly workflowName: string;
  readonly clientName?: string;
}

/** Plain text, used by Slack, Teams and Discord alike. Kept short and specific. */
export function renderText(action: AlertAction, ctx: MessageContext): string {
  const where = ctx.clientName ? `${ctx.clientName} / ${ctx.workflowName}` : ctx.workflowName;

  if (action.kind === 'resolved') {
    return [
      `Recovered: ${where}`,
      `"${action.statement}" is holding again after ${formatHours(action.wasFailingHours)}.`,
    ].join('\n');
  }

  const r = action.result;
  const head =
    action.kind === 'opened'
      ? `Silent failure: ${where}`
      : `Still failing after ${formatHours(action.sinceHours)}: ${where}`;

  const lines = [head, `"${r.statement}"`];
  if (r.detail) lines.push(r.detail);
  if (r.evidence) lines.push(`Captured: ${truncate(r.evidence, 300)}`);
  lines.push(
    r.basis === 'observation'
      ? 'This expectation was learned from history against an attested baseline.'
      : `This expectation came from ${r.basis === 'intent' ? 'a stated business intent' : "the workflow's own definition"}.`,
  );
  return lines.join('\n');
}

/** At most `n` characters in total, ellipsis included. */
function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes`;
  if (h < 48) return `${h.toFixed(1)} hours`;
  return `${(h / 24).toFixed(1)} days`;
}

function bodyFor(kind: ChannelKind, action: AlertAction, ctx: MessageContext): unknown {
  const text = renderText(action, ctx);
  switch (kind) {
    case 'slack':
      return { text };
    case 'discord':
      // Discord rejects anything over 2000 characters outright.
      return { content: truncate(text, 1900) };
    case 'teams':
      return { text };
    case 'webhook':
      // A generic consumer wants the structure, not our prose. Both are sent.
      return {
        kind: action.kind,
        workflow: ctx.workflowName,
        client: ctx.clientName,
        assertionId: action.assertionId,
        statement: action.kind === 'resolved' ? action.statement : action.result.statement,
        detail: action.kind === 'resolved' ? undefined : action.result.detail,
        evidence: action.kind === 'resolved' ? undefined : action.result.evidence,
        basis: action.kind === 'resolved' ? undefined : action.result.basis,
        text,
        at: new Date().toISOString(),
      };
  }
}

export interface SendOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export async function send(
  channels: readonly Channel[],
  action: AlertAction,
  ctx: MessageContext,
  opts: SendOptions = {},
): Promise<readonly DeliveryResult[]> {
  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  const results: DeliveryResult[] = [];
  for (const ch of channels) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await f(ch.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(bodyFor(ch.kind, action, ctx)),
        signal: ac.signal,
      });
      results.push({ channel: ch.kind, ok: res.ok, status: res.status });
    } catch (err) {
      results.push({
        channel: ch.kind,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
}
