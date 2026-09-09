/**
 * Evaluating a confirmed assertion against a captured run.
 *
 * Two rules govern everything here.
 *
 * First, only a confirmed, non-stale assertion can produce `proven` or
 * `violated`. Everything else is `unproven` with a reason. There is no code
 * path that turns silence into a pass.
 *
 * Second, `violated` must always carry the literal captured value that decided
 * it. If we cannot show the evidence, we do not make the accusation, because
 * telling an agency their client's automation is broken when it is not costs
 * more than the miss. Missing a defect leaves them where they already were.
 * Inventing one makes us the problem.
 */

import type {
  Assertion,
  AssertionResult,
  DegeneratePattern,
  Run,
  UnprovenReason,
} from '../contract/types';

const EVIDENCE_MAX = 300;

/** Truncate for display without ever altering what was found. */
function evidenceOf(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (s === undefined) return 'undefined';
  return s.length > EVIDENCE_MAX ? `${s.slice(0, EVIDENCE_MAX)}… (${s.length} chars)` : s;
}

/** Resolve a dot path such as "customer.email" against an item. */
export function fieldValue(item: unknown, path: string): { found: boolean; value: unknown } {
  if (item === null || typeof item !== 'object') return { found: false, value: undefined };
  let cur: unknown = item;
  for (const seg of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !(seg in (cur as Record<string, unknown>))) {
      return { found: false, value: undefined };
    }
    cur = (cur as Record<string, unknown>)[seg];
  }
  return { found: true, value: cur };
}

/**
 * Boundaries at which a string is suspiciously likely to have been cut off by a
 * column width or an API limit rather than by an author. Used to keep
 * truncation detection specific enough to be trusted.
 */
const TRUNCATION_BOUNDARIES = new Set([100, 128, 255, 256, 500, 512, 1000, 1024, 2000, 2048, 4000, 4096, 8000, 8192]);

const REFUSAL_PATTERNS: readonly RegExp[] = [
  /\bI'?m sorry,? but\b/i,
  /\bI (?:cannot|can'?t|am unable to|won'?t be able to)\b/i,
  /\bAs an AI(?: language model)?\b/i,
  /\bI (?:do not|don'?t) have (?:access|the ability)\b/i,
  /\bI'?m not able to (?:assist|help|provide)\b/i,
  /\bUnfortunately,? I\b/i,
];

const TEMPLATE_PATTERNS: readonly RegExp[] = [
  /\{\{[^{}]*\}\}/, // handlebars / n8n expressions that never rendered
  /\{%[^%]*%\}/, // jinja / liquid tags
  /\$\{[^{}]*\}/, // template literals that arrived as text
  /<%[^%]*%>/, // ejs / erb
];

const ERROR_TEXT_PATTERNS: readonly RegExp[] = [
  /\[object Object\]/,
  /^\s*(?:error|exception)\s*[:!]/i,
  /\bTraceback \(most recent call last\)/,
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EAI_AGAIN)\b/,
  /\bRequest failed with status code \d{3}\b/,
  /\bNaN\b/,
];

/**
 * Does this value show a specific degenerate pattern?
 * Only strings are considered; a real null is a shape problem, not a text one.
 */
export function matchDegenerate(value: unknown, pattern: DegeneratePattern): boolean {
  if (typeof value !== 'string') {
    // A genuine null or undefined is caught by `null-literal` only when it
    // arrived as the *text* "null", which is the bug worth naming. Real nulls
    // are the business of a shape assertion.
    return false;
  }
  switch (pattern) {
    case 'empty-string':
      return value.trim().length === 0;
    case 'unrendered-template':
      return TEMPLATE_PATTERNS.some((r) => r.test(value));
    case 'model-refusal':
      return REFUSAL_PATTERNS.some((r) => r.test(value));
    case 'error-text-in-value':
      return ERROR_TEXT_PATTERNS.some((r) => r.test(value));
    case 'null-literal':
      return /^\s*(?:null|undefined|nil|None)\s*$/.test(value);
    case 'truncation-marker':
      return /(?:\.{3}|…)$/.test(value) && TRUNCATION_BOUNDARIES.has(value.length);
  }
}

/**
 * How diagnostic a pattern is when several fire at once.
 *
 * An unrendered template names its own cause: an expression did not resolve. A
 * null literal three fields along is usually the same incident seen downstream.
 * Leading with the former sends someone to the right node.
 */
function severity(p: DegeneratePattern): number {
  switch (p) {
    case 'unrendered-template':
      return 6;
    case 'model-refusal':
      return 5;
    case 'error-text-in-value':
      return 4;
    case 'truncation-marker':
      return 3;
    case 'null-literal':
      return 2;
    case 'empty-string':
      return 1;
  }
}

export function describeDegenerate(pattern: DegeneratePattern): string {
  switch (pattern) {
    case 'empty-string':
      return 'was empty';
    case 'unrendered-template':
      return 'still contains an unrendered template expression, so a value was never substituted in';
    case 'model-refusal':
      return 'contains a model refusal, so the AI step declined and the workflow carried the refusal downstream as if it were content';
    case 'error-text-in-value':
      return 'contains error text where a value should be';
    case 'null-literal':
      return 'contains the text "null" rather than an absent value, which usually means a missing field was stringified somewhere upstream';
    case 'truncation-marker':
      return 'ends in an ellipsis at a common field-width boundary, which suggests it was cut off in transit rather than written that way';
  }
}

export interface EvaluateContext {
  /** The workflow revision the run executed against, if the platform reports it. */
  readonly currentWorkflowHash?: string;
}

function unproven(a: Assertion, reason: UnprovenReason): AssertionResult {
  return {
    assertionId: a.id,
    verdict: 'unproven',
    statement: a.statement,
    basis: a.basis,
    unprovenReason: reason,
  };
}

function proven(a: Assertion, evidence?: string): AssertionResult {
  return { assertionId: a.id, verdict: 'proven', statement: a.statement, basis: a.basis, evidence };
}

function violated(a: Assertion, detail: string, evidence?: string): AssertionResult {
  return { assertionId: a.id, verdict: 'violated', statement: a.statement, basis: a.basis, detail, evidence };
}

/**
 * Evaluate one assertion against one run.
 *
 * `cadence` is deliberately not handled here: it is a statement about runs that
 * did not happen, so it cannot be answered by looking at a run that did. See
 * evaluateCadence in ./cadence.
 */
export function evaluate(assertion: Assertion, run: Run, ctx: EvaluateContext = {}): AssertionResult {
  if (assertion.status === 'proposed') return unproven(assertion, 'only-proposed-assertions');
  if (assertion.status === 'stale') return unproven(assertion, 'contract-stale');
  if (assertion.status === 'retired') return unproven(assertion, 'assertion-not-applicable');

  // A confirmation is bound to a revision. If the run executed a different one,
  // we know the check no longer describes what ran, and we say so.
  if (
    ctx.currentWorkflowHash &&
    assertion.confirmation &&
    assertion.confirmation.workflowHash !== ctx.currentWorkflowHash
  ) {
    return unproven(assertion, 'contract-stale');
  }

  const p = assertion.params;

  if (p.kind === 'cadence') {
    // A statement about runs that did not happen cannot be answered by looking
    // at a run that did. See evaluateCadence in ./cadence.
    return unproven(assertion, 'assertion-not-applicable');
  }

  const items = run.sinkOutputs[assertion.sinkId];
  if (items === undefined) {
    // The node exists in the contract but nothing was captured for it. That is
    // not a pass and it is not a failure; it is a hole in our evidence.
    return unproven(assertion, 'sink-not-captured');
  }

  switch (p.kind) {
    case 'non-empty': {
      if (items.length === 0) {
        return violated(
          assertion,
          'The step produced no items. The run still reported success, which is how this goes unnoticed.',
          '[]',
        );
      }
      return proven(assertion, `${items.length} item(s)`);
    }

    case 'volume': {
      if (items.length < p.min || items.length > p.max) {
        return violated(
          assertion,
          `Expected between ${p.min} and ${p.max} items, found ${items.length}.`,
          `${items.length} item(s)`,
        );
      }
      return proven(assertion, `${items.length} item(s)`);
    }

    case 'shape': {
      for (let i = 0; i < items.length; i++) {
        for (const f of p.fields) {
          const { found, value } = fieldValue(items[i], f);
          if (!found) {
            return violated(assertion, `Item ${i} has no field "${f}".`, evidenceOf(items[i]));
          }
          if (!p.allowNull && (value === null || value === undefined)) {
            return violated(assertion, `Item ${i} has field "${f}" but its value is ${value === null ? 'null' : 'undefined'}.`, evidenceOf(items[i]));
          }
        }
      }
      return proven(assertion, `${items.length} item(s) carried ${p.fields.length} required field(s)`);
    }

    case 'not-degenerate': {
      // Scan everything rather than stopping at the first hit. When one upstream
      // rename breaks four fields at once, reporting whichever field happened to
      // be checked first buries the most diagnostic finding. Here the worst
      // problem leads and the rest are named alongside it.
      const hits = new Map<string, { field: string; pattern: DegeneratePattern; value: unknown; itemIndex: number }>();
      for (let i = 0; i < items.length; i++) {
        for (const f of p.fields) {
          const { found, value } = fieldValue(items[i], f);
          if (!found) continue; // Absence is a shape concern, not a text concern.
          for (const pattern of p.patterns) {
            const key = `${f}|${pattern}`;
            if (hits.has(key)) continue;
            if (matchDegenerate(value, pattern)) {
              hits.set(key, { field: f, pattern, value, itemIndex: i });
            }
          }
        }
      }

      if (hits.size === 0) {
        return proven(assertion, `${items.length} item(s) checked against ${p.patterns.length} pattern(s)`);
      }

      const ranked = [...hits.values()].sort((a, b) => severity(b.pattern) - severity(a.pattern));
      const lead = ranked[0]!;
      const others = ranked.slice(1);
      const also =
        others.length > 0
          ? ` Also affected in the same run: ${others.map((o) => `"${o.field}" (${o.pattern})`).join(', ')}.`
          : '';

      return violated(
        assertion,
        `Item ${lead.itemIndex}, field "${lead.field}" ${describeDegenerate(lead.pattern)}.${also}`,
        evidenceOf(lead.value),
      );
    }

    case 'referential': {
      // The strongest cheap check there is: prove the pipe actually carried the
      // data rather than producing something plausible of its own accord.
      if (!run.triggerInput || run.triggerInput.length === 0) {
        return unproven(assertion, 'run-data-unavailable');
      }
      const sourceValues = new Set<string>();
      for (const item of run.triggerInput) {
        const { found, value } = fieldValue(item, p.sourceField);
        if (found && value !== null && value !== undefined) sourceValues.add(String(value));
      }
      if (sourceValues.size === 0) return unproven(assertion, 'run-data-unavailable');

      for (let i = 0; i < items.length; i++) {
        const { found, value } = fieldValue(items[i], p.sinkField);
        if (!found) {
          return violated(assertion, `Item ${i} has no field "${p.sinkField}" to carry the input value into.`, evidenceOf(items[i]));
        }
        if (!sourceValues.has(String(value))) {
          return violated(
            assertion,
            `Item ${i} has "${p.sinkField}" = ${evidenceOf(value)}, which does not match any "${p.sourceField}" that entered this run. The step produced output that did not come from its input.`,
            evidenceOf(value),
          );
        }
      }
      return proven(assertion, `${items.length} item(s) traced back to the run's own input`);
    }

    case 'predicate': {
      for (let i = 0; i < items.length; i++) {
        const { found, value } = fieldValue(items[i], p.field);
        if (!found) {
          return violated(assertion, `Item ${i} has no field "${p.field}".`, evidenceOf(items[i]));
        }
        if (!testPredicate(value, p.op, p.value)) {
          return violated(
            assertion,
            `Item ${i}: "${p.field}" ${evidenceOf(value)} fails ${p.op} ${JSON.stringify(p.value)}.`,
            evidenceOf(value),
          );
        }
      }
      return proven(assertion, `${items.length} item(s) satisfied the predicate`);
    }
  }
}

export function testPredicate(value: unknown, op: string, expected: string | number): boolean {
  switch (op) {
    case 'equals':
      return String(value) === String(expected);
    case 'not-equals':
      return String(value) !== String(expected);
    case 'matches':
      return safeRegex(String(expected)).test(String(value));
    case 'not-matches':
      return !safeRegex(String(expected)).test(String(value));
    case 'gt':
      return numeric(value) > numeric(expected);
    case 'lt':
      return numeric(value) < numeric(expected);
    case 'gte':
      return numeric(value) >= numeric(expected);
    case 'lte':
      return numeric(value) <= numeric(expected);
    default:
      return false;
  }
}

function numeric(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v));
  return Number.isFinite(n) ? n : NaN;
}

function safeRegex(src: string): RegExp {
  try {
    return new RegExp(src);
  } catch {
    // An unparseable pattern must never throw mid-audit. It simply matches
    // nothing, and the assertion that carries it will read as violated, which
    // sends a human to look at the pattern.
    return /$^/;
  }
}
