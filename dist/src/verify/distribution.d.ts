/**
 * What the batch looks like as a whole.
 *
 * Some failures are invisible one task at a time and obvious across a hundred.
 * A pipeline that defers a third of its tickets is not doing anything wrong on
 * any single answer, but it is not resolving anything either. A pipeline whose
 * answers have all collapsed to the same three sentences has stopped reading its
 * input. A batch where almost nothing carries a checkable fact is a batch that
 * groundedness cannot actually see, and saying so is more honest than a page of
 * green ticks.
 *
 * These are rates and shapes, computed from the batch itself. No source, no
 * history, no model. History-relative drift (this batch against last week) is a
 * hosted concern and lives in the service, not here.
 *
 * The bias matches the rest of the codebase: a signal is a note for a person to
 * look, not an accusation against a task. Nothing here marks an individual
 * answer as a problem or fails a CI job on its own.
 */
export type BatchSignalKind = 'deferral-rate' | 'refusal-rate' | 'empty-rate' | 'collapse' | 'atom-drought' | 'length-outlier';
export interface BatchSignal {
    readonly kind: BatchSignalKind;
    /** `concern` is worth acting on; `notice` is worth a glance. */
    readonly severity: 'concern' | 'notice';
    /** One sentence, written for someone deciding whether to look closer. */
    readonly summary: string;
    /** A few task ids that exhibit it, so the reader knows where to start. */
    readonly sampleTaskIds: readonly string[];
}
/** The per-task facts the batch view is computed from. */
export interface TaskSignal {
    readonly id: string;
    readonly output: string;
    readonly deferred: boolean;
    readonly refused: boolean;
    readonly empty: boolean;
    readonly atomsChecked: number;
    /** True when groundedness actually ran (there was source material). */
    readonly grounded: boolean;
}
export declare function checkDistribution(tasks: readonly TaskSignal[]): readonly BatchSignal[];
