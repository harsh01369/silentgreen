/**
 * Checking a batch of AI work.
 *
 * Four questions, none of which requires asking a model what it thinks of
 * another model's answer:
 *
 *   1. Did it answer at all, or is this an empty string, an unrendered template
 *      or a refusal that got carried downstream as if it were content?
 *   2. Does every checkable fact in the answer appear in the material it was
 *      given, or did the model supply it?
 *   3. Did it actually do the work, or did it defer? An agent that hands every
 *      hard case to a human scores beautifully on completion and delivers
 *      nothing. One 2026 post-mortem describes a support agent hitting a 96%
 *      resolution rate by routing every unresolved ticket to human handoff:
 *      technically correct, financially disastrous.
 *   4. Is the answer suspiciously identical across tasks, which is what a
 *      pipeline looks like when it has quietly stopped reading its input?
 *
 * Every verdict here is decided by text the model did not write: the source
 * material, or the other answers in the batch.
 */

import { createHash } from 'node:crypto';
import { checkGrounding, type GroundingOptions, type UngroundedAtom } from '../verify/grounding';
import { matchDegenerate, describeDegenerate } from '../verify/assert';
import { checkConsistency } from '../verify/consistency';
import { checkConformance } from '../verify/conformance';
import { checkAssociation } from '../verify/association';
import { checkDistribution, type BatchSignal, type TaskSignal } from '../verify/distribution';
import type { DegeneratePattern } from '../contract/types';
import { groundingSourcesFor, type TaskRecord } from './record';

export type TaskProblemKind =
  | 'degenerate'
  | 'ungrounded'
  | 'deferred'
  | 'duplicated'
  | 'inconsistent'
  | 'malformed'
  | 'misattributed';

export interface TaskProblem {
  readonly kind: TaskProblemKind;
  /** One sentence, written for somebody deciding whether to act. */
  readonly summary: string;
  /** The literal text that decided it. Never paraphrased. */
  readonly evidence: string;
  /**
   * Where in the answer the finding sits, when it is a span (a fabricated
   * atom). Character offsets, no value. A redacted surface can mark the
   * position without ever holding the text.
   */
  readonly span?: { readonly start: number; readonly end: number; readonly atomKind: string };
}

export interface TaskResult {
  readonly id: string;
  readonly at?: string;
  readonly problems: readonly TaskProblem[];
  /** True when there was not enough material to reach a verdict. */
  readonly inconclusive: boolean;
  readonly inconclusiveReason?: string;
  readonly atomsChecked: number;
}

export interface BatchSummary {
  readonly total: number;
  readonly clean: number;
  readonly problematic: number;
  readonly inconclusive: number;
  readonly byKind: Readonly<Record<TaskProblemKind, number>>;
  /** The sentence to read first. */
  readonly headline: string;
  /** Stated plainly, because coverage is not the same as correctness. */
  readonly caveat: string;
  /**
   * Batch-level observations: rates and shapes that no single answer reveals.
   * Never counted as a per-task problem and never fails a job on their own.
   */
  readonly signals: readonly BatchSignal[];
}

const DEGENERATE_PATTERNS: readonly DegeneratePattern[] = [
  'empty-string',
  'unrendered-template',
  'model-refusal',
  'error-text-in-value',
  'null-literal',
];

/**
 * Phrases that hand the work back rather than doing it.
 *
 * Deliberately narrow. "You may also want to contact support" inside an
 * otherwise complete answer is helpful, not a deferral, so the phrase has to
 * carry the whole answer: short output, and the deferral near the start.
 */
const DEFERRAL_PATTERNS: readonly RegExp[] = [
  /\b(?:please )?(?:contact|reach out to|speak to|get in touch with) (?:our |a |the )?(?:support|customer service|human|agent|representative|team)\b/i,
  /\bI(?:'| a)m (?:going to |now )?(?:transfer|escalat|hand)(?:ring|ing)? (?:you |this )?(?:over |on )?to\b/i,
  /\bescalat(?:ing|ed) (?:this |your )?(?:to|for) (?:a |the )?(?:human|agent|team|specialist)\b/i,
  /\bI (?:cannot|can't|am unable to) (?:help|assist|answer|resolve)\b/i,
  /\bthis (?:will be|has been) (?:passed|routed|forwarded) to\b/i,
];

const DEFERRAL_MAX_CHARS = 400;

export function looksDeferred(output: string): { deferred: boolean; matched?: string } {
  const trimmed = output.trim();
  if (trimmed.length === 0 || trimmed.length > DEFERRAL_MAX_CHARS) return { deferred: false };
  for (const re of DEFERRAL_PATTERNS) {
    const m = re.exec(trimmed);
    // Only a deferral if it is the substance of the answer rather than a footnote.
    if (m && (m.index ?? 0) < trimmed.length * 0.6) return { deferred: true, matched: m[0] };
  }
  return { deferred: false };
}

function fingerprint(s: string): string {
  return createHash('sha256').update(s.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

export interface CheckOptions extends GroundingOptions {
  /** Skip groundedness entirely, for batches with no source material. */
  readonly skipGrounding?: boolean;
  /** How many identical answers before it is a finding rather than a coincidence. */
  readonly duplicateThreshold?: number;
}

export function checkBatch(records: readonly TaskRecord[], opts: CheckOptions = {}): {
  readonly results: readonly TaskResult[];
  readonly summary: BatchSummary;
} {
  // Flat, not proportional. Scaling this with batch size meant three identical
  // answers in a batch of twenty went unreported, and three different questions
  // producing one byte-identical answer is worth a look at any scale. Pipelines
  // with legitimately templated replies can raise it.
  const duplicateThreshold = opts.duplicateThreshold ?? 3;

  // An answer repeated across many different inputs usually means a pipeline
  // stopped reading its input. One repeat is a coincidence; a third of the
  // batch is a defect.
  const counts = new Map<string, number>();
  for (const r of records) {
    const fp = fingerprint(r.output);
    counts.set(fp, (counts.get(fp) ?? 0) + 1);
  }

  const results: TaskResult[] = [];
  const byKind: Record<TaskProblemKind, number> = {
    degenerate: 0,
    ungrounded: 0,
    deferred: 0,
    duplicated: 0,
    inconsistent: 0,
    malformed: 0,
    misattributed: 0,
  };

  const taskSignals: TaskSignal[] = [];

  for (const record of records) {
    const problems: TaskProblem[] = [];

    let degenerateKind: DegeneratePattern | undefined;
    for (const pattern of DEGENERATE_PATTERNS) {
      if (matchDegenerate(record.output, pattern)) {
        degenerateKind = pattern;
        problems.push({
          kind: 'degenerate',
          summary: `The answer ${describeDegenerate(pattern)}.`,
          evidence: record.output.slice(0, 300),
        });
        break; // One is enough; the rest are the same incident.
      }
    }

    const deferral = looksDeferred(record.output);
    if (deferral.deferred) {
      problems.push({
        kind: 'deferred',
        summary:
          'The answer hands the task back rather than doing it. This counts as a completed task in most pipelines, which is how a high resolution rate can coexist with nothing being resolved.',
        evidence: deferral.matched ?? record.output.slice(0, 200),
      });
    }

    const dupCount = counts.get(fingerprint(record.output)) ?? 0;
    if (dupCount >= duplicateThreshold && record.output.trim().length > 0) {
      problems.push({
        kind: 'duplicated',
        summary: `This exact answer was produced for ${dupCount} different tasks, which usually means the pipeline stopped reading its input.`,
        evidence: record.output.slice(0, 200),
      });
    }

    for (const bad of checkConsistency(record.output)) {
      problems.push({ kind: 'inconsistent', summary: bad.summary, evidence: bad.evidence });
    }

    for (const bad of checkConformance(record.output, record.input)) {
      problems.push({ kind: 'malformed', summary: bad.summary, evidence: bad.evidence });
    }

    let inconclusive = false;
    let inconclusiveReason: string | undefined;
    let atomsChecked = 0;
    let groundingRan = false;

    if (!opts.skipGrounding) {
      const { sources, basis, note } = groundingSourcesFor(record);
      const g = checkGrounding(record.output, sources, opts);
      atomsChecked = g.checked;
      groundingRan = basis !== 'none';

      if (basis === 'sources') {
        for (const bad of checkAssociation(record.output, sources)) {
          problems.push({ kind: 'misattributed', summary: bad.summary, evidence: bad.evidence });
        }
      }
      if (g.inconclusive) {
        inconclusive = problems.length === 0;
        inconclusiveReason = note ? `${g.reason} ${note}` : g.reason;
      } else if (basis === 'prompt' && g.ungrounded.length > 0) {
        // Checked against the prompt alone. Atoms missing from it are unproven,
        // not fabrications, because the real source material was never captured.
        inconclusive = problems.length === 0;
        inconclusiveReason = `${g.ungrounded.length} fact(s) in the answer could not be traced. ${note}`;
      } else {
        for (const u of g.ungrounded) {
          problems.push({
            kind: 'ungrounded',
            summary: `"${u.text}" is ${u.why}.`,
            evidence: u.text,
            span: { start: u.start, end: u.end, atomKind: u.kind },
          });
        }
      }
    }

    for (const p of problems) byKind[p.kind] += 1;

    taskSignals.push({
      id: record.id,
      output: record.output,
      deferred: deferral.deferred,
      refused: degenerateKind === 'model-refusal',
      empty: degenerateKind === 'empty-string' || degenerateKind === 'null-literal',
      atomsChecked,
      grounded: groundingRan,
    });

    results.push({
      id: record.id,
      at: record.at,
      problems,
      inconclusive,
      inconclusiveReason,
      atomsChecked,
    });
  }

  const signals = checkDistribution(taskSignals);

  const problematic = results.filter((r) => r.problems.length > 0).length;
  const inconclusiveCount = results.filter((r) => r.inconclusive).length;
  const clean = results.length - problematic - inconclusiveCount;

  const pct = results.length > 0 ? Math.round((problematic / results.length) * 100) : 0;
  const headline =
    problematic === 0
      ? `${results.length} answers checked, none carrying a problem this can detect.`
      : `${problematic} of ${results.length} answers (${pct}%) contain something the pipeline reported as a success.`;

  return {
    results,
    summary: {
      total: results.length,
      clean,
      problematic,
      inconclusive: inconclusiveCount,
      byKind,
      headline,
      signals,
      caveat:
        'This checks whether an answer is empty, refused, unrendered, deferred, duplicated, self-contradictory, malformed when it should be structured, built from facts the source pairs differently, or contains specifics absent from its own source material. It does not check whether the answer is wise, complete or appropriate, and a clean result is not a claim that the work was good. No model was asked to grade another model.',
    },
  };
}
