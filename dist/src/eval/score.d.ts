/**
 * Scoring the checks against a labelled corpus.
 *
 * This is how "did the change make it better or worse" stops being a matter of
 * opinion. Every batch in `corpus/` carries a human label for every task, and
 * this module runs the real engine over it and reports where the two disagree.
 *
 * The metric that gates a release is not accuracy. It is the false positive
 * rate on answers labelled clean, because an answer wrongly accused of
 * fabrication is the one failure this tool does not survive. A release that
 * flags a faithful answer fails, regardless of how much its recall improved.
 */
import { type CheckOptions, type TaskProblemKind } from '../aiwork/check';
import type { TaskRecord } from '../aiwork/record';
export type LabelVerdict = 'clean' | 'problem' | 'inconclusive';
export interface TaskLabel {
    readonly id: string;
    readonly verdict: LabelVerdict;
    /** For a problem: which kinds a correct run must report. */
    readonly kinds?: readonly TaskProblemKind[];
    /** For an ungrounded problem: the specific atoms that should be named. */
    readonly atoms?: readonly string[];
    /** Why this label is what it is, for the person reading a disagreement. */
    readonly note?: string;
    /**
     * A documented limitation. The engine gets this one wrong today, we know why,
     * and it is written here rather than hidden. It is reported but does not fail
     * the gate. Remove the marker when the fix lands.
     */
    readonly xfail?: string;
}
export interface LabelledBatch {
    readonly name: string;
    readonly records: readonly TaskRecord[];
    readonly labels: readonly TaskLabel[];
    /** True once real, third-party data has replaced the synthetic fixtures. */
    readonly synthetic: boolean;
    readonly checkOptions?: CheckOptions;
}
export interface Disagreement {
    readonly id: string;
    readonly expected: LabelVerdict;
    readonly got: LabelVerdict;
    readonly kind: 'false-positive' | 'missed-problem' | 'wrong-reason' | 'inconclusive-mismatch' | 'atom-mismatch';
    readonly detail: string;
    /** Set when the label carried an `xfail` reason: a known, documented gap. */
    readonly knownGap?: string;
}
export interface Scoreboard {
    readonly batch: string;
    readonly synthetic: boolean;
    readonly tasks: number;
    readonly truePositives: number;
    readonly falsePositives: number;
    readonly falseNegatives: number;
    readonly trueNegatives: number;
    readonly inconclusiveCorrect: number;
    readonly inconclusiveMismatch: number;
    /** Labelled disagreements that are documented limitations, not regressions. */
    readonly knownGaps: number;
    readonly precision: number;
    readonly recall: number;
    readonly f1: number;
    /** falsePositives / (answers labelled clean). The number that gates a release. */
    readonly falsePositiveRate: number;
    readonly byKindRecall: Readonly<Record<string, {
        expected: number;
        caught: number;
    }>>;
    readonly atomPrecision: number;
    readonly atomRecall: number;
    readonly disagreements: readonly Disagreement[];
}
export declare function scoreBatch(batch: LabelledBatch): Scoreboard;
export interface GateThresholds {
    readonly minPrecision: number;
    readonly minRecall: number;
    /** Answers labelled clean that were flagged. Almost always 0. */
    readonly maxFalsePositives: number;
}
export declare const DEFAULT_GATE: GateThresholds;
export interface GateResult {
    readonly ok: boolean;
    readonly failures: readonly string[];
}
export declare function gate(boards: readonly Scoreboard[], t?: GateThresholds): GateResult;
