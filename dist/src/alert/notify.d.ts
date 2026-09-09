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
export declare function channelsFromEnv(env?: NodeJS.ProcessEnv): readonly Channel[];
export interface MessageContext {
    readonly workflowName: string;
    readonly clientName?: string;
}
/** Plain text, used by Slack, Teams and Discord alike. Kept short and specific. */
export declare function renderText(action: AlertAction, ctx: MessageContext): string;
export interface SendOptions {
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
}
export declare function send(channels: readonly Channel[], action: AlertAction, ctx: MessageContext, opts?: SendOptions): Promise<readonly DeliveryResult[]>;
