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
import type { ActionRecord, TaskRecord } from '../aiwork/record';
import { type BatchSummary, type CheckOptions } from '../aiwork/check';
/** Where captured tasks go when the buffer is flushed. */
export type Sink = string | {
    readonly url: string;
    readonly apiKey: string;
    readonly project?: string;
} | ((records: readonly TaskRecord[]) => void | Promise<void>);
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
    record(record: Omit<TaskRecord, 'id'> & {
        id?: string;
    }): TaskRecord;
    /** Everything captured and not yet flushed. */
    pending(): readonly TaskRecord[];
    /** Run the engine locally over the buffer, without flushing. For tests and inline checks. */
    check(opts?: CheckOptions): {
        readonly summary: BatchSummary;
        readonly records: readonly TaskRecord[];
    };
    /** Send the buffer to the sink and clear it. Returns the number sent. */
    flush(): Promise<number>;
}
export declare function createRecorder(options?: RecorderOptions): Recorder;
