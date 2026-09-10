/**
 * One task, laid out for a person to read side by side.
 *
 * The answer on the left with every checkable atom marked: green where it
 * traces to the source, an oxidised underline where it appears nowhere, with
 * the reason under each one. The source on the right with the figures the
 * answer got right lit up, so a reviewer can see the match rather than take it
 * on trust.
 *
 * Pure. It runs the same groundedness check the rest of the engine runs and
 * then arranges the result; it decides nothing a model could have decided.
 */
import { type AtomKind } from './grounding';
import { type TaskRecord } from '../aiwork/record';
export type SegmentKind = 'plain' | 'grounded' | 'ungrounded';
export interface AnswerSegment {
    readonly text: string;
    readonly kind: SegmentKind;
    readonly atomKind?: AtomKind;
    /** For an ungrounded segment: the sentence a reviewer needs. */
    readonly why?: string;
}
export interface SourceHighlight {
    readonly start: number;
    readonly end: number;
    readonly atomKind: AtomKind;
    readonly text: string;
}
export interface QuoteFinding {
    readonly text: string;
    readonly grounded: boolean;
}
export interface TaskInspection {
    readonly id: string;
    readonly answer: string;
    readonly segments: readonly AnswerSegment[];
    readonly source: string;
    readonly sourceHighlights: readonly SourceHighlight[];
    readonly quotes: readonly QuoteFinding[];
    readonly counts: {
        readonly grounded: number;
        readonly ungrounded: number;
        readonly checked: number;
    };
    readonly basis: 'sources' | 'prompt' | 'none';
    readonly note?: string;
    /** True when there was too little to check for the layout to mean much. */
    readonly inconclusive: boolean;
    readonly reason?: string;
}
export declare function inspectTask(record: TaskRecord): TaskInspection;
