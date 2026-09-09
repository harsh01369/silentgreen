/**
 * A small glob, for the shapes a CI step actually passes: `traces/*.jsonl`,
 * `out/**\/*.json`. Deliberately not a full implementation, just enough to
 * avoid depending on an experimental Node API. Supports `*`, `?` and `**`.
 */
export declare function expandGlob(pattern: string): string[];
