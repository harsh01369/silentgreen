/**
 * The engine as a library.
 *
 * Everything here is pure and deterministic: given the same input and the same
 * check versions, the same verdicts. No network, no model. The hosted service
 * imports this and adds storage, identity and a web surface on top; it does not
 * reimplement any of it.
 */

// Reading whatever a pipeline exported.
export {
  parseTaskRecords,
  groundingSourcesFor,
  type TaskRecord,
  type ParseResult,
  type ParseIssue,
} from './aiwork/record';
export { extractTrace, type TraceExtract } from './aiwork/adapters';
export type { ActionRecord } from './aiwork/record';

// Recording AI work as it happens (also available as `silentgreen/record`).
export {
  createRecorder,
  type Recorder,
  type RecorderOptions,
  type Sink,
  type TaskContext,
  type TaskSeed,
} from './record/recorder';

// The checks.
export {
  checkBatch,
  looksDeferred,
  type TaskResult,
  type TaskProblem,
  type TaskProblemKind,
  type BatchSummary,
  type CheckOptions,
} from './aiwork/check';
export { checkGrounding, extractAtoms, type GroundingResult, type Atom, type AtomKind } from './verify/grounding';
export { checkConsistency, type Inconsistency, type InconsistencyKind } from './verify/consistency';
export { checkConformance, type Malformed, type MalformedKind } from './verify/conformance';
export { checkAssociation, type Misassociation } from './verify/association';
export {
  inspectTask,
  type TaskInspection,
  type AnswerSegment,
  type SegmentKind,
  type SourceHighlight,
  type QuoteFinding,
} from './verify/inspect';
export { checkDistribution, type BatchSignal, type BatchSignalKind, type TaskSignal } from './verify/distribution';

// The contract layer (Tier 2): rules a human wrote down, checked deterministically.
export {
  parseContract,
  evaluateContract,
  type Contract,
  type ContractBasis,
  type ContractReport,
  type ContractTaskResult,
  type ClauseOutcome,
  type ClauseVerdict,
  type MustContain,
  type ActionRule,
} from './aiwork/contract';
export { draftContract } from './aiwork/contract-draft';
export { parseYaml, type YamlValue } from './util/yaml';

// The worked example.
export { demoTasks } from './aiwork/demo';

// Scoring against a labelled corpus.
export {
  scoreBatch,
  gate,
  DEFAULT_GATE,
  type Scoreboard,
  type LabelledBatch,
  type TaskLabel,
  type GateThresholds,
  type GateResult,
} from './eval/score';
export { builtinBatches } from './eval/corpus';

// The evidence ledger.
export { Ledger, verifyChain, hashEntry } from './ledger/chain';

// The confirmation gate and the domain model.
export { confirmAssertion, isSubstantiveAttestation, coverageHonesty } from './contract/circularity';
export type {
  Basis,
  AssertionKind,
  Assertion,
  AssertionStatus,
  AssertionResult,
  Verdict,
  UnprovenReason,
  Confirmation,
  Run,
  WorkflowRef,
} from './contract/types';
