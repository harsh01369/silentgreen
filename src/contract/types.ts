/**
 * The domain model.
 *
 * A monitoring tool asks "did it crash?". This asks a harder question:
 * "did it do its job, and how do you know?".
 *
 * The whole design turns on one distinction that every existing tool in this
 * space collapses: WHERE AN EXPECTATION CAME FROM. An expectation learned from
 * the system's own past output cannot, on its own, tell you the system was ever
 * correct. It can only tell you the system is still doing whatever it was
 * already doing. That is circular, and circular checks are how a queue grows
 * silently for three months while every run reports green.
 *
 * So every assertion carries its `basis`, and the confirmation rules differ by
 * basis. This file is where that is enforced.
 */

/** Which platform a workflow lives on. More can be added; the core is agnostic. */
export type Platform = 'n8n' | 'make';

/**
 * Where an expectation came from. Ordered from strongest to weakest evidence
 * of *correctness* (as opposed to mere consistency).
 *
 * - `intent`      A human said what this workflow is for, before or independent
 *                 of looking at its output. Non-circular. The only basis that
 *                 can establish that the system was ever right.
 *
 * - `structure`   Derived from the workflow definition: the graph declares it
 *                 writes three fields to a sheet, so we assert three fields.
 *                 Semi-circular. It proves the workflow does what it says it
 *                 does. It cannot prove what it says is what the business needed.
 *
 * - `observation` Derived from historical runs: this step has returned between
 *                 40 and 60 items every day for a month. Circular by
 *                 construction. Useful for catching change, worthless for
 *                 establishing correctness, and dangerous if the baseline
 *                 period was already broken.
 */
export type Basis = 'intent' | 'structure' | 'observation';

export type AssertionKind =
  /** The run produced at least one item at this sink. */
  | 'non-empty'
  /** Named fields are present, and non-null, on every item. */
  | 'shape'
  /** Item count falls inside a range. */
  | 'volume'
  /** A value that entered the workflow reappears at the sink, unmangled. */
  | 'referential'
  /** No item contains text matching a known-degenerate pattern. */
  | 'not-degenerate'
  /** The workflow ran at all, within an expected interval. */
  | 'cadence'
  /** A field's value satisfies a stated predicate. */
  | 'predicate';

/**
 * Text patterns that indicate a run technically succeeded and substantively
 * failed. These are the shapes a 200 OK takes when nothing useful happened.
 *
 * Deliberately conservative. A false accusation that a client's automation is
 * broken costs more trust than a missed detection, because the missed detection
 * is the status quo and the false accusation is our fault.
 */
export type DegeneratePattern =
  | 'empty-string'
  | 'unrendered-template'
  | 'model-refusal'
  | 'error-text-in-value'
  | 'null-literal'
  | 'truncation-marker';

/** Confirmation is the moment a proposal becomes able to produce a verdict. */
export interface Confirmation {
  /** Who took responsibility. Free text; an email or a name. Never inferred. */
  readonly by: string;
  readonly at: string; // ISO 8601
  /**
   * The workflow revision this was confirmed against. If the workflow changes,
   * the assertion goes stale rather than silently continuing to pass.
   */
  readonly workflowHash: string;
  /**
   * The specific runs the confirmer was shown when they agreed. Recorded so the
   * confirmation can be audited later: "you approved this having seen these."
   */
  readonly evidenceRunIds: readonly string[];
  /**
   * Required for, and only meaningful on, `observation` basis. The confirmer
   * states that the period the expectation was learned from was known to be
   * good, and says how they know. Without this, an observation assertion is a
   * measurement of a habit, not a standard.
   */
  readonly baselineAttestation?: {
    readonly windowStart: string;
    readonly windowEnd: string;
    /** How the confirmer knows that window was good. Free text, required. */
    readonly howKnown: string;
  };
}

export type AssertionStatus =
  /** Generated, not yet answerable by a human. Produces no verdicts. */
  | 'proposed'
  /** Confirmed and bound to the current workflow revision. Live. */
  | 'confirmed'
  /** Was confirmed; the workflow has since changed. Produces `unproven`. */
  | 'stale'
  /** Deliberately withdrawn. Kept for the audit trail, never deleted. */
  | 'retired';

export interface Assertion {
  readonly id: string;
  readonly workflowId: string;
  /** The node/module whose output this constrains. */
  readonly sinkId: string;
  readonly kind: AssertionKind;
  readonly basis: Basis;
  /**
   * Human-readable, in the language of the business rather than the graph.
   * "Every run files at least one invoice" beats "node_17.items.length > 0".
   */
  readonly statement: string;
  /** Kind-specific configuration. Validated at construction. */
  readonly params: AssertionParams;
  readonly status: AssertionStatus;
  readonly confirmation?: Confirmation;
  /** Set when status became `stale`, so a report can say what changed and when. */
  readonly stale?: { readonly since: string; readonly fromHash: string; readonly toHash: string };
  readonly createdAt: string;
}

export type AssertionParams =
  | { readonly kind: 'non-empty' }
  | { readonly kind: 'shape'; readonly fields: readonly string[]; readonly allowNull?: boolean }
  | { readonly kind: 'volume'; readonly min: number; readonly max: number }
  | { readonly kind: 'referential'; readonly sourceField: string; readonly sinkField: string }
  | { readonly kind: 'not-degenerate'; readonly fields: readonly string[]; readonly patterns: readonly DegeneratePattern[] }
  | { readonly kind: 'cadence'; readonly expectEverySeconds: number; readonly graceSeconds: number }
  | { readonly kind: 'predicate'; readonly field: string; readonly op: PredicateOp; readonly value: string | number };

export type PredicateOp = 'equals' | 'not-equals' | 'matches' | 'not-matches' | 'gt' | 'lt' | 'gte' | 'lte';

/**
 * The three outcomes. There is no `pass`.
 *
 * `proven` means a confirmed, non-stale assertion was evaluated against real
 * captured output and held. Anything we did not actually establish is
 * `unproven`, and unproven is reported as loudly as violated, because a silent
 * gap in coverage is the exact failure this product exists to surface.
 */
export type Verdict = 'proven' | 'violated' | 'unproven';

export type UnprovenReason =
  | 'no-assertions'
  | 'only-proposed-assertions'
  | 'contract-stale'
  | 'sink-not-captured'
  | 'run-data-unavailable'
  | 'assertion-not-applicable';

export interface AssertionResult {
  readonly assertionId: string;
  readonly verdict: Verdict;
  readonly statement: string;
  readonly basis: Basis;
  /** Present when violated: what was expected and what was actually found. */
  readonly detail?: string;
  /** The literal captured value that decided it. Truncated, never fabricated. */
  readonly evidence?: string;
  readonly unprovenReason?: UnprovenReason;
}

/** A normalised execution, whatever platform it came from. */
export interface Run {
  readonly id: string;
  readonly workflowId: string;
  readonly platform: Platform;
  readonly startedAt: string;
  readonly finishedAt?: string;
  /** What the platform itself thought. Usually 'success'. That is the problem. */
  readonly platformStatus: 'success' | 'error' | 'running' | 'waiting' | 'unknown';
  /** Captured output per node/module id. Absent keys mean not captured. */
  readonly sinkOutputs: Readonly<Record<string, readonly unknown[]>>;
  /** Captured input to the trigger, used by `referential` assertions. */
  readonly triggerInput?: readonly unknown[];
}

export interface WorkflowRef {
  readonly id: string;
  readonly platform: Platform;
  readonly name: string;
  readonly active: boolean;
  /** Semantic hash of the graph. Cosmetic edits do not change it. */
  readonly hash: string;
  /** Client this workflow belongs to, for agencies running many. */
  readonly clientId?: string;
}

/** The full verdict for one run. */
export interface RunVerification {
  readonly runId: string;
  readonly workflowId: string;
  readonly evaluatedAt: string;
  readonly results: readonly AssertionResult[];
  /** Worst outcome present, in the order violated > unproven > proven. */
  readonly summary: Verdict;
}
