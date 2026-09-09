/**
 * Reading a record of AI work.
 *
 * The unit is a task: something was asked, some material was available, an
 * answer came back. That shape is the same whether it came from an agent
 * framework, a RAG pipeline, a support bot, a batch summarisation job or a
 * spreadsheet somebody exported, and every one of those has the same problem:
 * the answer looks right and nobody can afford to check all of them by hand.
 *
 * So the parser is deliberately forgiving about field names. Every tool in this
 * space calls these things something different, and refusing to read a file
 * because it says `completion` rather than `output` would be a pointless way to
 * lose a user in the first thirty seconds.
 */
export interface TaskRecord {
    readonly id: string;
    readonly at?: string;
    /** What was asked. */
    readonly input: string;
    /** Everything the model could legitimately have drawn on. */
    readonly sources: readonly string[];
    /** What came back. */
    readonly output: string;
    readonly meta?: Readonly<Record<string, unknown>>;
}
export interface ParseIssue {
    readonly line: number;
    readonly reason: string;
}
export interface ParseResult {
    readonly records: readonly TaskRecord[];
    readonly issues: readonly ParseIssue[];
}
/**
 * Parse JSONL, or a JSON array, into task records.
 *
 * Unreadable lines are reported rather than skipped in silence. A parser that
 * quietly drops a third of the file and then reports no problems would be an
 * unusually poor joke in this particular codebase.
 */
export declare function parseTaskRecords(text: string): ParseResult;
/**
 * What the model was allowed to draw on.
 *
 * When no explicit sources are given, the prompt is used as a fallback, but a
 * mismatch against the prompt alone is reported as unproven rather than as a
 * fabrication. The material the answer should have been checked against was
 * never captured, and that is a gap in the evidence, not proof of invention.
 */
export declare function groundingSourcesFor(record: TaskRecord): {
    sources: readonly string[];
    basis: 'sources' | 'prompt' | 'none';
    note?: string;
};
