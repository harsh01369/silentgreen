/**
 * If the answer was supposed to be structured, is it?
 *
 * A pipeline that asks a model for JSON and feeds the result straight into the
 * next step fails hard when the model returns JSON wrapped in an apology, or a
 * markdown fence, or a response that was cut off mid-object. None of that needs
 * a source or a model to detect: the text either parses as what it claims to be
 * or it does not.
 *
 * As everywhere here, it only speaks when the answer is clearly meant to be
 * structured. Prose that happens to contain a brace is left alone.
 */
export type MalformedKind = 'unparseable-json' | 'json-with-surrounding-prose' | 'truncated' | 'ragged-table';
export interface Malformed {
    readonly kind: MalformedKind;
    readonly summary: string;
    readonly evidence: string;
}
export declare function checkConformance(output: string, input?: string): readonly Malformed[];
