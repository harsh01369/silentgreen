/**
 * Does the answer contradict itself?
 *
 * This needs no source material and no model. An answer that states a subtotal,
 * a tax amount and a total where the three do not add up has a defect on its
 * face, whatever the invoice says. So does one that quotes two different figures
 * for the same thing, or a due date that falls before the issue date.
 *
 * The bias is the same as everywhere else in this codebase: only speak when the
 * arithmetic is unambiguous. A total that could be reconciled by a shipping
 * line or a discount the answer also mentions is left alone.
 */
export type InconsistencyKind = 'arithmetic' | 'restated-value' | 'date-order' | 'percentage';
export interface Inconsistency {
    readonly kind: InconsistencyKind;
    /** One sentence, for someone deciding whether to act. */
    readonly summary: string;
    /** The literal figures or dates that decided it. */
    readonly evidence: string;
}
export declare function checkConsistency(output: string): readonly Inconsistency[];
