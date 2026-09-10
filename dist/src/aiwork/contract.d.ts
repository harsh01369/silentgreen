/**
 * The contract layer.
 *
 * Tier 0 checks need nothing from the user. A contract is the first thing they
 * write down: a short file that says what this pipeline is actually for, so the
 * verdict can be about the job and not just about the text.
 *
 * It stays inside the same rule as everything else here. Every clause is a
 * deterministic comparison. `must_contain: {kind: money}` asks whether the
 * extractor found a money atom, not whether a model thinks the answer is
 * complete. `currency == source.currency` compares two tokens. No clause
 * consults a model, and every clause returns one of the three verdicts.
 *
 * The `attests` line is mandatory and is printed next to every result the
 * contract produces, because a rule nobody will put their name to is a rule
 * nobody should be trusting.
 */
import { type AtomKind } from '../verify/grounding';
import { type TaskRecord } from './record';
export type ContractBasis = 'intent' | 'structure' | 'observation';
export type ClauseVerdict = 'proven' | 'violated' | 'unproven';
export interface MustContain {
    readonly kind?: AtomKind;
    readonly pattern?: string;
}
export interface ActionRule {
    /** A regex. When the output matches, the required action must be present. */
    readonly when: string;
    readonly require: {
        readonly kind: string;
        /** `source.email`, `source.url`, or a literal regex the target must match. */
        readonly target_matches?: string;
    };
}
export interface Contract {
    readonly pipeline: string;
    readonly basis: ContractBasis;
    readonly attests: string;
    /**
     * The prompt or instruction file this contract was confirmed against, and a
     * hash of it at that moment. When `check` is given the current prompt and it
     * no longer matches, every result this contract would call `proven` becomes
     * `unproven`: the thing the rules were written for has changed underneath
     * them, and a green result about a prompt that no longer exists is exactly
     * what this tool refuses to give.
     */
    readonly bound_to?: {
        readonly prompt: string;
        readonly prompt_sha: string;
    };
    readonly output?: {
        readonly must_contain?: readonly MustContain[];
        readonly must_not_contain?: readonly MustContain[];
        readonly grounded?: {
            readonly kinds?: readonly AtomKind[];
        };
        readonly predicates?: readonly string[];
    };
    readonly actions?: readonly ActionRule[];
    readonly consistency?: boolean;
}
export declare function promptSha(text: string): string;
export interface ClauseOutcome {
    readonly clause: string;
    readonly verdict: ClauseVerdict;
    readonly detail: string;
    readonly evidence?: string;
}
export interface ContractTaskResult {
    readonly id: string;
    readonly verdict: ClauseVerdict;
    readonly clauses: readonly ClauseOutcome[];
}
export interface ContractReport {
    readonly contract: Contract;
    readonly tasks: readonly ContractTaskResult[];
    readonly summary: {
        readonly proven: number;
        readonly violated: number;
        readonly unproven: number;
        readonly byClause: Readonly<Record<string, {
            proven: number;
            violated: number;
            unproven: number;
        }>>;
    };
    /** The coverage-honesty sentence for this contract. */
    readonly honesty: string;
    /** True when the bound prompt has changed since the contract was confirmed. */
    readonly stale: boolean;
    readonly staleReason?: string;
}
export interface EvaluateOptions {
    /** The current text of the prompt the contract is `bound_to`, to check for drift. */
    readonly promptText?: string;
}
export declare function parseContract(text: string, filename?: string): {
    contract?: Contract;
    errors: readonly string[];
};
export declare function evaluateContract(contract: Contract, records: readonly TaskRecord[], opts?: EvaluateOptions): ContractReport;
