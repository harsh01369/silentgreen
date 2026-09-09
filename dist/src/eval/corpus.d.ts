/**
 * The labelled corpus.
 *
 * Every batch here is synthetic. It was written to pin down what the engine
 * should do, not drawn from real traffic, and until real third-party batches
 * replace it the numbers it produces measure "does the engine behave the way
 * its author intended" and nothing stronger. That distinction is the whole
 * point of the `synthetic` flag, and the eval output states it every time.
 *
 * Three kinds of batch:
 *
 *   billing-support        the worked example, labelled task by task
 *   faithful-adversarial   correct answers built to trip a naive matcher:
 *                          trailing punctuation, reformatted dates and money,
 *                          sentence-initial names, quotations repunctuated
 *   fabrication-adversarial subtle inventions: a transposed figure, a plausible
 *                          invoice number, an address on a real domain
 *
 * plus small batches for degenerate output, deferral, and the inconclusive case.
 */
import type { LabelledBatch } from './score';
export declare function builtinBatches(): readonly LabelledBatch[];
