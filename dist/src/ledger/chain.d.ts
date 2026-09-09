/**
 * The evidence ledger.
 *
 * Two separate needs meet here, and it is worth being explicit about both
 * because only one of them is technical.
 *
 * The technical need: when a report says a check was confirmed on 3 September
 * and a violation was caught on the 11th, that ordering has to be something
 * other than a claim. Each entry commits to the one before it, so an entry
 * cannot be edited, backdated or quietly dropped without every later hash
 * failing to reproduce.
 *
 * The commercial need, which the practitioners named directly: an agency
 * running automations for a client has no artefact to show for the months when
 * nothing went wrong. "A well-built automation becomes invisible and runs for
 * three clean months, and the retainer starts to look like a line item without
 * a job." A ledger of what was checked, what was caught and what was confirmed
 * by whom is the difference between a bill and an invoice with work behind it.
 *
 * This is not a blockchain and does not pretend to be. It is a hash chain in a
 * file the agency controls, which is the correct amount of machinery: it makes
 * accidental corruption and casual editing detectable, and it makes no claim
 * against a determined operator who owns the file, because such a claim would
 * be false.
 */
export type LedgerEntryKind = 'workflow-observed' | 'proposal-made' | 'assertion-confirmed' | 'assertion-refused' | 'assertion-retired' | 'contract-stale' | 'run-verified' | 'violation' | 'absence-detected' | 'note';
export interface LedgerEntry {
    readonly seq: number;
    readonly at: string;
    readonly kind: LedgerEntryKind;
    readonly workflowId: string;
    readonly clientId?: string;
    /** Entry-specific detail. Canonicalised before hashing. */
    readonly payload: Readonly<Record<string, unknown>>;
    /** Hash of the previous entry, or 64 zeroes for the first. */
    readonly prevHash: string;
    readonly hash: string;
}
export declare const GENESIS_PREV: string;
export declare function hashEntry(e: Omit<LedgerEntry, 'hash'>): string;
export declare class Ledger {
    private readonly path?;
    private entries;
    constructor(path?: string | undefined);
    get length(): number;
    all(): readonly LedgerEntry[];
    get head(): string;
    append(kind: LedgerEntryKind, workflowId: string, payload: Readonly<Record<string, unknown>>, opts?: {
        readonly clientId?: string;
        readonly at?: string;
    }): LedgerEntry;
    /** Entries for one workflow, oldest first. */
    forWorkflow(workflowId: string): readonly LedgerEntry[];
    /** Entries inside a period, for a client report. */
    between(fromIso: string, toIso: string, clientId?: string): readonly LedgerEntry[];
    verify(): {
        readonly ok: true;
    } | {
        readonly ok: false;
        readonly brokenAt: number;
        readonly reason: string;
    };
}
/**
 * Recompute every hash and every link.
 *
 * Reports call this before they print anything, and print the result. A report
 * that asserts its own integrity without checking is decoration.
 */
export declare function verifyChain(entries: readonly LedgerEntry[]): {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly brokenAt: number;
    readonly reason: string;
};
