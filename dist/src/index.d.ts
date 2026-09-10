/**
 * The engine as a library.
 *
 * Everything here is pure and deterministic: given the same input and the same
 * check versions, the same verdicts. No network, no model. The hosted service
 * imports this and adds storage, identity and a web surface on top; it does not
 * reimplement any of it.
 */
export { parseTaskRecords, groundingSourcesFor, type TaskRecord, type ParseResult, type ParseIssue, } from './aiwork/record';
export { extractTrace, type TraceExtract } from './aiwork/adapters';
export type { ActionRecord } from './aiwork/record';
export { createRecorder, type Recorder, type RecorderOptions, type Sink, type TaskContext, type TaskSeed, } from './record/recorder';
export { checkBatch, looksDeferred, type TaskResult, type TaskProblem, type TaskProblemKind, type BatchSummary, type CheckOptions, } from './aiwork/check';
export { checkGrounding, extractAtoms, type GroundingResult, type Atom, type AtomKind } from './verify/grounding';
export { checkConsistency, type Inconsistency, type InconsistencyKind } from './verify/consistency';
export { checkConformance, type Malformed, type MalformedKind } from './verify/conformance';
export { checkAssociation, type Misassociation } from './verify/association';
export { checkDistribution, type BatchSignal, type BatchSignalKind, type TaskSignal } from './verify/distribution';
export { parseContract, evaluateContract, type Contract, type ContractBasis, type ContractReport, type ContractTaskResult, type ClauseOutcome, type ClauseVerdict, type MustContain, type ActionRule, } from './aiwork/contract';
export { draftContract } from './aiwork/contract-draft';
export { parseYaml, type YamlValue } from './util/yaml';
export { demoTasks } from './aiwork/demo';
export { scoreBatch, gate, DEFAULT_GATE, type Scoreboard, type LabelledBatch, type TaskLabel, type GateThresholds, type GateResult, } from './eval/score';
export { builtinBatches } from './eval/corpus';
export { Ledger, verifyChain, hashEntry } from './ledger/chain';
export { confirmAssertion, isSubstantiveAttestation, coverageHonesty } from './contract/circularity';
export type { Basis, AssertionKind, Assertion, AssertionStatus, AssertionResult, Verdict, UnprovenReason, Confirmation, Run, WorkflowRef, } from './contract/types';
