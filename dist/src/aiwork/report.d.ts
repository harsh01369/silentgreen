/**
 * The evidence record for a batch of AI work.
 *
 * This is the artefact an agency hands to a client, or to whoever is asking
 * whether the AI decisions going in front of customers were checked. It is a
 * single self-contained HTML file, printable, with no external assets and no
 * scripts.
 *
 * The same two rules as the automation report:
 *
 *   - It leads with what could not be established, not with what passed. A
 *     document that opens with a wall of green trains its reader to skim.
 *   - It never turns an absence of findings into a claim of correctness. The
 *     coverage sentence at the top says in plain English what these checks can
 *     and cannot prove.
 *
 * It carries a hash computed deterministically from the batch and the check
 * versions, so two people running the same batch produce byte-identical hashes,
 * and a changed report is a changed hash.
 */
import { type BatchSummary } from './check';
import { type TaskRecord } from './record';
import type { ContractReport } from './contract';
export interface EvidenceReportInput {
    readonly records: readonly TaskRecord[];
    /** A label for this batch: a filename, a date range, a job id. */
    readonly batchLabel: string;
    readonly clientName?: string;
    readonly preparedBy?: string;
    readonly periodLabel?: string;
    readonly contract?: ContractReport;
    /** Keep the shape of each finding, not the value. Default true. */
    readonly redact?: boolean;
}
/**
 * A stable fingerprint of the batch and what was checked. Deterministic: no
 * timestamps, no order dependence beyond the records themselves.
 */
export declare function evidenceHash(input: EvidenceReportInput, summary: BatchSummary): string;
export declare function renderEvidenceReport(input: EvidenceReportInput): string;
