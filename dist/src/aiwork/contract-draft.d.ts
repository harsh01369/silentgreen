/**
 * A first draft of a contract, inferred from a batch.
 *
 * Inference only proposes. Every line it writes is something the batch already
 * does consistently, phrased as a rule, for a person to keep, cut or tighten.
 * The `attests` line is left as a placeholder on purpose: the one thing that
 * cannot be inferred is who is willing to stand behind the rules.
 */
import type { TaskRecord } from './record';
export interface DraftOptions {
    readonly pipeline?: string;
    /** Path and text of a prompt to bind the contract to. */
    readonly prompt?: {
        readonly path: string;
        readonly text: string;
    };
}
export declare function draftContract(records: readonly TaskRecord[], pipelineOrOpts?: string | DraftOptions): string;
