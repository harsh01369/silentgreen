/**
 * Recording AI work as it happens.
 *
 * The file importer reads an export after the fact. This is the other way in:
 * a thin wrapper you put around the call your agent or chain already makes, so
 * the question, the retrieved material, the answer and any actions are captured
 * at the moment they exist, in the exact shape the checks want.
 *
 *   import { createRecorder } from 'silentgreen/record';
 *
 *   const sg = createRecorder({ sink: 'silentgreen.jsonl' });
 *
 *   const answer = await sg.task({ input: question }, async (t) => {
 *     const docs = await retrieve(question);
 *     t.source(docs.map((d) => d.text));
 *     const out = await llm(question, docs);
 *     t.action({ kind: 'email.sent', target: customer.email });
 *     return out;              // becomes the task output
 *   });
 *
 *   await sg.flush();          // write the file, or POST the batch
 *
 * No dependencies. No network unless you choose an HTTP sink. Nothing here
 * decides a verdict; it only captures, so the engine has something honest to
 * check later.
 */

import { appendFileSync } from 'node:fs';
import type { ActionRecord, TaskRecord } from '../aiwork/record';
import { checkBatch, type BatchSummary, type CheckOptions } from '../aiwork/check';

/** Where captured tasks go when the buffer is flushed. */
export type Sink =
  | string // a path; each flush appends newline-delimited JSON
  | { readonly url: string; readonly apiKey: string; readonly project?: string }
  | ((records: readonly TaskRecord[]) => void | Promise<void>);

export interface RecorderOptions {
  readonly sink?: Sink;
  /** Prefix for auto-generated task ids. Default `task`. */
  readonly idPrefix?: string;
  /**
   * Flush automatically once this many tasks are buffered. Default off: you
   * call `flush()` yourself, usually at the end of a run.
   */
  readonly flushEvery?: number;
}

/** The handle passed to a `task()` body, for attaching material as you go. */
export interface TaskContext {
  /** Add retrieved material. Call as often as you like; strings accumulate. */
  source(text: string | readonly string[]): void;
  /** Record something the pipeline actually did. */
  action(action: ActionRecord): void;
  /** Override or set the input after the fact. */
  input(text: string): void;
  /** Set the output explicitly (otherwise the body's return value is used). */
  output(text: string): void;
  /** Attach free-form metadata. */
  meta(patch: Record<string, unknown>): void;
}

export interface TaskSeed {
  readonly id?: string;
  readonly input?: string;
  readonly sources?: readonly string[];
  readonly at?: string;
  readonly meta?: Record<string, unknown>;
}

export interface Recorder {
  /**
   * Wrap a unit of work. The body's return value is captured as the output
   * (stringified if it is not already a string) and passed straight back to
   * you, so this is a transparent wrapper.
   */
  task<T>(seed: TaskSeed, body: (t: TaskContext) => T | Promise<T>): Promise<T>;
  /** Record a task you assembled yourself. */
  record(record: Omit<TaskRecord, 'id'> & { id?: string }): TaskRecord;
  /** Everything captured and not yet flushed. */
  pending(): readonly TaskRecord[];
  /** Run the engine locally over the buffer, without flushing. For tests and inline checks. */
  check(opts?: CheckOptions): { readonly summary: BatchSummary; readonly records: readonly TaskRecord[] };
  /** Send the buffer to the sink and clear it. Returns the number sent. */
  flush(): Promise<number>;
}

function asText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v == null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function createRecorder(options: RecorderOptions = {}): Recorder {
  const buffer: TaskRecord[] = [];
  const prefix = options.idPrefix ?? 'task';
  let counter = 0;

  const nextId = () => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

  const commit = (record: TaskRecord): TaskRecord => {
    buffer.push(record);
    if (options.flushEvery && buffer.length >= options.flushEvery) {
      void flush();
    }
    return record;
  };

  async function flush(): Promise<number> {
    if (buffer.length === 0) return 0;
    const batch = buffer.splice(0, buffer.length);
    const sink = options.sink;

    if (!sink) return batch.length; // captured only; caller will read pending()

    if (typeof sink === 'function') {
      await sink(batch);
      return batch.length;
    }

    if (typeof sink === 'string') {
      const lines = batch.map((r) => JSON.stringify(r)).join('\n') + '\n';
      appendFileSync(sink, lines, 'utf8');
      return batch.length;
    }

    const body =
      sink.project !== undefined
        ? JSON.stringify({ project: sink.project, tasks: batch })
        : batch.map((r) => JSON.stringify(r)).join('\n');
    const res = await fetch(new URL('/v1/batches', sink.url), {
      method: 'POST',
      headers: {
        'content-type': sink.project !== undefined ? 'application/json' : 'application/x-ndjson',
        'x-api-key': sink.apiKey,
      },
      body,
    });
    if (!res.ok) {
      // Put the batch back so a later flush can retry, and surface the reason.
      buffer.unshift(...batch);
      const detail = await res.text().catch(() => '');
      throw new Error(`silentgreen sink rejected the batch (${res.status}): ${detail.slice(0, 300)}`);
    }
    return batch.length;
  }

  return {
    async task(seed, body) {
      const sources: string[] = [...(seed.sources ?? [])];
      const actions: ActionRecord[] = [];
      const meta: Record<string, unknown> = { ...(seed.meta ?? {}) };
      let input = seed.input ?? '';
      let explicitOutput: string | undefined;

      const ctx: TaskContext = {
        source: (text) => {
          if (Array.isArray(text)) sources.push(...text.filter((s) => typeof s === 'string' && s.trim()));
          else if (typeof text === 'string' && text.trim()) sources.push(text);
        },
        action: (a) => actions.push(a),
        input: (t) => {
          input = t;
        },
        output: (t) => {
          explicitOutput = t;
        },
        meta: (patch) => Object.assign(meta, patch),
      };

      const returned = await body(ctx);
      const output = explicitOutput ?? asText(returned);

      commit({
        id: seed.id ?? nextId(),
        ...(seed.at ? { at: seed.at } : { at: new Date().toISOString() }),
        input,
        sources,
        output,
        ...(actions.length > 0 ? { actions } : {}),
        ...(Object.keys(meta).length > 0 ? { meta } : {}),
      });

      return returned;
    },

    record(record) {
      return commit({
        id: record.id ?? nextId(),
        at: record.at ?? new Date().toISOString(),
        input: record.input,
        sources: record.sources,
        output: record.output,
        ...(record.actions && record.actions.length > 0 ? { actions: record.actions } : {}),
        ...(record.meta ? { meta: record.meta } : {}),
      });
    },

    pending: () => [...buffer],

    check: (opts) => {
      const records = [...buffer];
      return { summary: checkBatch(records, opts).summary, records };
    },

    flush,
  };
}
