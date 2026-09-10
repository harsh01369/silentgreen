/**
 * Checking a batch of AI work.
 *
 * Four questions, none of which requires asking a model what it thinks of
 * another model's answer:
 *
 *   1. Did it answer at all, or is this an empty string, an unrendered template
 *      or a refusal that got carried downstream as if it were content?
 *   2. Does every checkable fact in the answer appear in the material it was
 *      given, or did the model supply it?
 *   3. Did it actually do the work, or did it defer? An agent that hands every
 *      hard case to a human scores beautifully on completion and delivers
 *      nothing. One 2026 post-mortem describes a support agent hitting a 96%
 *      resolution rate by routing every unresolved ticket to human handoff:
 *      technically correct, financially disastrous.
 *   4. Is the answer suspiciously identical across tasks, which is what a
 *      pipeline looks like when it has quietly stopped reading its input?
 *
 * Every verdict here is decided by text the model did not write: the source
 * material, or the other answers in the batch.
 */
import { type GroundingOptions } from '../verify/grounding';
import { type BatchSignal } from '../verify/distribution';
import { type TaskRecord } from './record';
export type TaskProblemKind = 'degenerate' | 'ungrounded' | 'deferred' | 'duplicated' | 'inconsistent' | 'malformed' | 'misattributed';
export interface TaskProblem {
    readonly kind: TaskProblemKind;
    /** One sentence, written for somebody deciding whether to act. */
    readonly summary: string;
    /** The literal text that decided it. Never paraphrased. */
    readonly evidence: string;
    /**
     * Where in the answer the finding sits, when it is a span (a fabricated
     * atom). Character offsets, no value. A redacted surface can mark the
     * position without ever holding the text.
     */
    readonly span?: {
        readonly start: number;
        readonly end: number;
        readonly atomKind: string;
    };
}
export interface TaskResult {
    readonly id: string;
    readonly at?: string;
    readonly problems: readonly TaskProblem[];
    /** True when there was not enough material to reach a verdict. */
    readonly inconclusive: boolean;
    readonly inconclusiveReason?: string;
    readonly atomsChecked: number;
}
export interface BatchSummary {
    readonly total: number;
    readonly clean: number;
    readonly problematic: number;
    readonly inconclusive: number;
    readonly byKind: Readonly<Record<TaskProblemKind, number>>;
    /** The sentence to read first. */
    readonly headline: string;
    /** Stated plainly, because coverage is not the same as correctness. */
    readonly caveat: string;
    /**
     * Batch-level observations: rates and shapes that no single answer reveals.
     * Never counted as a per-task problem and never fails a job on their own.
     */
    readonly signals: readonly BatchSignal[];
}
export declare function looksDeferred(output: string): {
    deferred: boolean;
    matched?: string;
};
export interface CheckOptions extends GroundingOptions {
    /** Skip groundedness entirely, for batches with no source material. */
    readonly skipGrounding?: boolean;
    /** How many identical answers before it is a finding rather than a coincidence. */
    readonly duplicateThreshold?: number;
}
export declare function checkBatch(records: readonly TaskRecord[], opts?: CheckOptions): {
    readonly results: readonly TaskResult[];
    readonly summary: BatchSummary;
};
