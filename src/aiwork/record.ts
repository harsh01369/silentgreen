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

const INPUT_KEYS = ['input', 'prompt', 'question', 'query', 'task', 'instruction', 'request'];
const OUTPUT_KEYS = ['output', 'response', 'answer', 'completion', 'result', 'generation', 'text'];
const SOURCE_KEYS = ['sources', 'context', 'documents', 'docs', 'retrieved', 'chunks', 'evidence', 'reference', 'references', 'ground_truth_context'];
const ID_KEYS = ['id', 'task_id', 'trace_id', 'run_id', 'request_id', 'uuid'];
const TIME_KEYS = ['at', 'timestamp', 'time', 'created_at', 'started_at'];

function firstString(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
    // Some exporters wrap the value: { output: { text: "..." } }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = v as Record<string, unknown>;
      for (const ik of ['text', 'content', 'value', 'message']) {
        const iv = inner[ik];
        if (typeof iv === 'string' && iv.trim().length > 0) return iv;
      }
    }
  }
  return undefined;
}

/** Sources may be a string, an array of strings, or an array of documents. */
function collectSources(obj: Record<string, unknown>): readonly string[] {
  const out: string[] = [];
  for (const k of SOURCE_KEYS) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) out.push(v);
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string' && item.trim()) out.push(item);
        else if (item && typeof item === 'object') {
          const rec = item as Record<string, unknown>;
          for (const ik of ['text', 'content', 'page_content', 'body', 'chunk', 'value']) {
            const iv = rec[ik];
            if (typeof iv === 'string' && iv.trim()) {
              out.push(iv);
              break;
            }
          }
        }
      }
    }
  }
  return out;
}

/**
 * Parse JSONL, or a JSON array, into task records.
 *
 * Unreadable lines are reported rather than skipped in silence. A parser that
 * quietly drops a third of the file and then reports no problems would be an
 * unusually poor joke in this particular codebase.
 */
export function parseTaskRecords(text: string): ParseResult {
  const records: TaskRecord[] = [];
  const issues: ParseIssue[] = [];

  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown[];
      arr.forEach((item, i) => {
        const r = toRecord(item, i + 1, issues);
        if (r) records.push(r);
      });
      return { records, issues };
    } catch (err) {
      return { records, issues: [{ line: 1, reason: `The file starts with "[" but is not valid JSON: ${String(err)}` }] };
    }
  }

  const lines = trimmed.split('\n');
  lines.forEach((line, i) => {
    const l = line.trim();
    if (!l) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(l);
    } catch {
      issues.push({ line: i + 1, reason: 'Not valid JSON.' });
      return;
    }
    const r = toRecord(parsed, i + 1, issues);
    if (r) records.push(r);
  });

  return { records, issues };
}

function toRecord(item: unknown, line: number, issues: ParseIssue[]): TaskRecord | undefined {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    issues.push({ line, reason: 'Not an object.' });
    return undefined;
  }
  const obj = item as Record<string, unknown>;

  const output = firstString(obj, OUTPUT_KEYS);
  if (!output) {
    issues.push({
      line,
      reason: `No output found. Looked for: ${OUTPUT_KEYS.join(', ')}. Without an answer there is nothing to check.`,
    });
    return undefined;
  }

  const input = firstString(obj, INPUT_KEYS) ?? '';
  const sources = collectSources(obj);
  const id = firstString(obj, ID_KEYS) ?? `line-${line}`;
  const at = firstString(obj, TIME_KEYS);

  return { id, at, input, sources, output, meta: obj };
}

/**
 * What the model was allowed to draw on.
 *
 * When no explicit sources are given, the prompt is used as a fallback, but a
 * mismatch against the prompt alone is reported as unproven rather than as a
 * fabrication. The material the answer should have been checked against was
 * never captured, and that is a gap in the evidence, not proof of invention.
 */
export function groundingSourcesFor(record: TaskRecord): {
  sources: readonly string[];
  basis: 'sources' | 'prompt' | 'none';
  note?: string;
} {
  if (record.sources.length > 0) return { sources: record.sources, basis: 'sources' };
  if (record.input.trim().length > 0) {
    return {
      sources: [record.input],
      basis: 'prompt',
      note: 'No retrieved sources were recorded, so the answer could only be checked against the prompt. Anything absent from the prompt is reported as unproven, not as a fabrication.',
    };
  }
  return { sources: [], basis: 'none', note: 'Neither sources nor a prompt were recorded, so nothing could be checked.' };
}
