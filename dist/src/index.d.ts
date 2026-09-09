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
export { checkBatch, looksDeferred, type TaskResult, type TaskProblem, type TaskProblemKind, type BatchSummary, type CheckOptions, } from './aiwork/check';
export { checkGrounding, extractAtoms, type GroundingResult, type Atom, type AtomKind } from './verify/grounding';
export { checkConsistency, type Inconsistency, type InconsistencyKind } from './verify/consistency';
export { checkConformance, type Malformed, type MalformedKind } from './verify/conformance';
export { demoTasks } from './aiwork/demo';
export { scoreBatch, gate, DEFAULT_GATE, type Scoreboard, type LabelledBatch, type TaskLabel, type GateThresholds, type GateResult, } from './eval/score';
export { builtinBatches } from './eval/corpus';
export { Ledger, verifyChain, hashEntry } from './ledger/chain';
export { confirmAssertion, isSubstantiveAttestation, coverageHonesty } from './contract/circularity';
export type { Basis, AssertionKind, Assertion, AssertionStatus, AssertionResult, Verdict, UnprovenReason, Confirmation, Run, WorkflowRef, } from './contract/types';
