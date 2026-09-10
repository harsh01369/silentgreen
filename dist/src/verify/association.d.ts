/**
 * Two facts that are each in the source, joined in a way the source does not.
 *
 * Atom-level groundedness passes an answer where every figure and every date
 * occurs somewhere in the material. It cannot see that the £571 belongs to one
 * invoice and the due date to another, because both strings are present. That
 * is the RAG failure that atom checking misses: the right pieces, wired up
 * wrong.
 *
 * This looks for it, and only in the one case where it can be sure enough to
 * speak: the source splits cleanly into more than one record, the answer pairs
 * an amount with a due date, the amount sits in exactly one record, the date
 * sits in a different one, and the amount's own record carries a different
 * date. When all of that holds, the verdict is `unproven`, not `violated`,
 * with a sentence naming both records, because the honest statement is "the
 * source pairs these differently, check which record this answer is about".
 *
 * No model. Everything here is string position in the source.
 */
export interface Misassociation {
    /** One sentence, for someone deciding whether to look. */
    readonly summary: string;
    /** The literal figures and the record boundaries that decided it. */
    readonly evidence: string;
}
export declare function checkAssociation(output: string, sources: readonly string[]): readonly Misassociation[];
