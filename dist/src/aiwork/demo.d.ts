/**
 * A worked example of AI work, so `check` can be run with nothing to set up.
 *
 * This is a support agent answering billing questions with a retrieved invoice
 * in front of it. Twenty tasks. Every one of them would be recorded as a
 * completed task by the pipeline that produced it, and would score well on any
 * evaluation that asks a language model whether the answer looks helpful,
 * because all twenty do look helpful.
 *
 * Five of them are wrong in ways that cost money.
 */
import type { TaskRecord } from './record';
export declare function demoTasks(): readonly TaskRecord[];
