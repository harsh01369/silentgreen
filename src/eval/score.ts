/**
 * Scoring the checks against a labelled corpus.
 *
 * This is how "did the change make it better or worse" stops being a matter of
 * opinion. Every batch in `corpus/` carries a human label for every task, and
 * this module runs the real engine over it and reports where the two disagree.
 *
 * The metric that gates a release is not accuracy. It is the false positive
 * rate on answers labelled clean, because an answer wrongly accused of
 * fabrication is the one failure this tool does not survive. A release that
 * flags a faithful answer fails, regardless of how much its recall improved.
 */

import { checkBatch, type CheckOptions, type TaskProblemKind } from '../aiwork/check';
import type { TaskRecord } from '../aiwork/record';

export type LabelVerdict = 'clean' | 'problem' | 'inconclusive';

export interface TaskLabel {
  readonly id: string;
  readonly verdict: LabelVerdict;
  /** For a problem: which kinds a correct run must report. */
  readonly kinds?: readonly TaskProblemKind[];
  /** For an ungrounded problem: the specific atoms that should be named. */
  readonly atoms?: readonly string[];
  /** Why this label is what it is, for the person reading a disagreement. */
  readonly note?: string;
  /**
   * A documented limitation. The engine gets this one wrong today, we know why,
   * and it is written here rather than hidden. It is reported but does not fail
   * the gate. Remove the marker when the fix lands.
   */
  readonly xfail?: string;
}

export interface LabelledBatch {
  readonly name: string;
  readonly records: readonly TaskRecord[];
  readonly labels: readonly TaskLabel[];
  /** True once real, third-party data has replaced the synthetic fixtures. */
  readonly synthetic: boolean;
  readonly checkOptions?: CheckOptions;
}

export interface Disagreement {
  readonly id: string;
  readonly expected: LabelVerdict;
  readonly got: LabelVerdict;
  readonly kind: 'false-positive' | 'missed-problem' | 'wrong-reason' | 'inconclusive-mismatch' | 'atom-mismatch';
  readonly detail: string;
  /** Set when the label carried an `xfail` reason: a known, documented gap. */
  readonly knownGap?: string;
}

export interface Scoreboard {
  readonly batch: string;
  readonly synthetic: boolean;
  readonly tasks: number;

  readonly truePositives: number;
  readonly falsePositives: number;
  readonly falseNegatives: number;
  readonly trueNegatives: number;
  readonly inconclusiveCorrect: number;
  readonly inconclusiveMismatch: number;
  /** Labelled disagreements that are documented limitations, not regressions. */
  readonly knownGaps: number;

  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  /** falsePositives / (answers labelled clean). The number that gates a release. */
  readonly falsePositiveRate: number;

  readonly byKindRecall: Readonly<Record<string, { expected: number; caught: number }>>;
  readonly atomPrecision: number;
  readonly atomRecall: number;

  readonly disagreements: readonly Disagreement[];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:!?)\]}'"]+$/, '');
}

function ratio(n: number, d: number): number {
  return d === 0 ? 1 : n / d;
}

export function scoreBatch(batch: LabelledBatch): Scoreboard {
  const byId = new Map(batch.labels.map((l) => [l.id, l]));
  const { results } = checkBatch(batch.records, batch.checkOptions);

  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let incOk = 0;
  let incBad = 0;
  let knownGaps = 0;

  const byKindRecall: Record<string, { expected: number; caught: number }> = {};
  let atomTp = 0;
  let atomFp = 0;
  let atomFn = 0;
  const disagreements: Disagreement[] = [];

  for (const r of results) {
    const label = byId.get(r.id);
    if (!label) continue;

    const got: LabelVerdict = r.problems.length > 0 ? 'problem' : r.inconclusive ? 'inconclusive' : 'clean';
    const gotKinds = new Set(r.problems.map((p) => p.kind));
    const gotAtoms = new Set(r.problems.filter((p) => p.kind === 'ungrounded').map((p) => norm(p.evidence)));

    if (label.verdict === 'clean') {
      if (got === 'problem') {
        if (label.xfail) knownGaps += 1;
        else fp += 1;
        disagreements.push({
          id: r.id,
          expected: 'clean',
          got,
          kind: 'false-positive',
          detail: `flagged as ${[...gotKinds].join(', ')}: ${r.problems.map((p) => p.summary).join(' | ')}`,
          knownGap: label.xfail,
        });
      } else {
        tn += 1;
        if (got === 'inconclusive') {
          disagreements.push({
            id: r.id,
            expected: 'clean',
            got,
            kind: 'inconclusive-mismatch',
            detail: r.inconclusiveReason ?? 'no checkable atoms',
          });
        }
      }
    } else if (label.verdict === 'problem') {
      if (got === 'problem') {
        tp += 1;
        for (const k of label.kinds ?? []) {
          byKindRecall[k] ??= { expected: 0, caught: 0 };
          byKindRecall[k].expected += 1;
          if (gotKinds.has(k)) byKindRecall[k].caught += 1;
          else {
            disagreements.push({
              id: r.id,
              expected: 'problem',
              got,
              kind: 'wrong-reason',
              detail: `expected a ${k} finding, got ${[...gotKinds].join(', ') || 'none'}`,
            });
          }
        }
        if (label.atoms && label.atoms.length > 0) {
          const want = new Set(label.atoms.map(norm));
          for (const a of want) (gotAtoms.has(a) ? atomTp++ : atomFn++);
          for (const a of gotAtoms) if (!want.has(a)) atomFp++;
          const missed = [...want].filter((a) => !gotAtoms.has(a));
          const extra = [...gotAtoms].filter((a) => !want.has(a));
          if (missed.length || extra.length) {
            disagreements.push({
              id: r.id,
              expected: 'problem',
              got,
              kind: 'atom-mismatch',
              detail: `${missed.length ? `missed [${missed.join(', ')}]` : ''}${missed.length && extra.length ? '; ' : ''}${
                extra.length ? `also flagged [${extra.join(', ')}]` : ''
              }`,
            });
          }
        }
      } else {
        if (label.xfail) knownGaps += 1;
        else fn += 1;
        for (const k of label.kinds ?? []) {
          byKindRecall[k] ??= { expected: 0, caught: 0 };
          if (!label.xfail) byKindRecall[k].expected += 1;
        }
        disagreements.push({
          id: r.id,
          expected: 'problem',
          got,
          kind: 'missed-problem',
          detail: label.note ? `${label.note}` : `expected ${[...(label.kinds ?? [])].join(', ') || 'a problem'}`,
          knownGap: label.xfail,
        });
      }
    } else {
      // labelled inconclusive
      if (got === 'inconclusive') incOk += 1;
      else {
        if (label.xfail) knownGaps += 1;
        else incBad += 1;
        disagreements.push({
          id: r.id,
          expected: 'inconclusive',
          got,
          kind: 'inconclusive-mismatch',
          detail: got === 'problem' ? r.problems.map((p) => p.summary).join(' | ') : 'reached a clean verdict on too little material',
          knownGap: label.xfail,
        });
      }
    }
  }

  const cleanLabelled = batch.labels.filter((l) => l.verdict === 'clean').length;
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);

  return {
    batch: batch.name,
    synthetic: batch.synthetic,
    tasks: results.length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
    inconclusiveCorrect: incOk,
    inconclusiveMismatch: incBad,
    knownGaps,
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
    falsePositiveRate: ratio(fp, cleanLabelled),
    byKindRecall,
    atomPrecision: ratio(atomTp, atomTp + atomFp),
    atomRecall: ratio(atomTp, atomTp + atomFn),
    disagreements,
  };
}

export interface GateThresholds {
  readonly minPrecision: number;
  readonly minRecall: number;
  /** Answers labelled clean that were flagged. Almost always 0. */
  readonly maxFalsePositives: number;
}

export const DEFAULT_GATE: GateThresholds = {
  minPrecision: 0.95,
  minRecall: 0.85,
  maxFalsePositives: 0,
};

export interface GateResult {
  readonly ok: boolean;
  readonly failures: readonly string[];
}

export function gate(boards: readonly Scoreboard[], t: GateThresholds = DEFAULT_GATE): GateResult {
  const failures: string[] = [];
  let fp = 0;
  let tp = 0;
  let fn = 0;

  for (const b of boards) {
    fp += b.falsePositives;
    tp += b.truePositives;
    fn += b.falseNegatives;
    if (b.falsePositives > 0) {
      failures.push(`${b.batch}: ${b.falsePositives} faithful answer(s) flagged as a problem`);
    }
  }

  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  if (fp > t.maxFalsePositives) failures.push(`total false positives ${fp} exceeds ${t.maxFalsePositives}`);
  if (precision < t.minPrecision) failures.push(`precision ${precision.toFixed(3)} below ${t.minPrecision}`);
  if (recall < t.minRecall) failures.push(`recall ${recall.toFixed(3)} below ${t.minRecall}`);

  return { ok: failures.length === 0, failures };
}
