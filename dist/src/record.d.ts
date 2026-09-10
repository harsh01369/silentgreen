/**
 * `silentgreen/record`: the SDK recorder, as its own entry point.
 *
 * A thin wrapper you put around the call your agent or chain already makes, so
 * the question, the retrieved material, the answer and any actions are captured
 * at the moment they exist. See src/record/recorder.ts for the full contract.
 */
export { createRecorder, type Recorder, type RecorderOptions, type Sink, type TaskContext, type TaskSeed, } from './record/recorder';
export type { TaskRecord, ActionRecord } from './aiwork/record';
export type { BatchSummary } from './aiwork/check';
