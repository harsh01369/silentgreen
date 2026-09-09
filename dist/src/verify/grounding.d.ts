/**
 * Did the answer come from the source, or from the model?
 *
 * This is the check the rest of this market cannot make honestly, because the
 * standard method is to ask another language model whether the answer looks
 * right. That is marking homework with the same pen. The published numbers on
 * it are not encouraging: judges score their own family's output higher, flip
 * preference on about a quarter of hard cases under repeated scoring, and drop
 * from roughly 80% agreement in a controlled test to worse than a coin flip on
 * bias probes in production.
 *
 * So this asks a smaller question that has an actual answer. Not "is this good"
 * but "does every checkable atom in the output appear in the material the model
 * was given". Numbers, dates, money, emails, URLs, identifiers, quoted spans and
 * capitalised names are all things that either occur in the source or do not.
 * No model is consulted. The verdict is decided by the source text, which is why
 * it can be trusted about a model.
 *
 * It is deliberately narrow. It cannot tell you an answer is wise, complete or
 * well-judged. It can tell you the invoice total the agent quoted appears
 * nowhere in the invoice, which is the failure that actually costs money.
 *
 * The bias runs hard towards silence. A false accusation that an AI fabricated
 * something is worse than a miss, because the miss leaves you where you already
 * were and the accusation makes this tool the problem.
 */
/** What kind of thing we found, so a report can say why it matters. */
export type AtomKind = 'number' | 'money' | 'date' | 'email' | 'url' | 'identifier' | 'quote' | 'name';
export interface Atom {
    readonly kind: AtomKind;
    readonly text: string;
    /** Normalised for comparison. Two atoms match when these are equal. */
    readonly key: string;
}
export interface UngroundedAtom extends Atom {
    /** Written for somebody deciding whether this is a real fabrication. */
    readonly why: string;
}
export interface GroundingResult {
    readonly checked: number;
    readonly ungrounded: readonly UngroundedAtom[];
    /** True when there was too little to check for the answer to mean anything. */
    readonly inconclusive: boolean;
    readonly reason?: string;
}
/**
 * Pull out the things in this text that are either true of the source or not.
 *
 * Order matters: an email is matched before the number inside it, so an address
 * does not also produce three spurious number atoms.
 */
export declare function extractAtoms(text: string): readonly Atom[];
export interface GroundingOptions {
    /** Kinds to check. Narrowing this is the main way to quieten a noisy corpus. */
    readonly kinds?: readonly AtomKind[];
    /** Below this many checkable atoms, we decline to conclude anything. */
    readonly minAtoms?: number;
}
/**
 * Check an answer against the material it was given.
 *
 * `sources` is everything the model could legitimately have drawn on: retrieved
 * documents, the prompt, tool results, the record it was asked to summarise.
 */
export declare function checkGrounding(output: string, sources: readonly string[], opts?: GroundingOptions): GroundingResult;
