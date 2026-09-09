/**
 * Proposing contracts.
 *
 * Nobody writes assertions for twenty workflows by hand, which is why the
 * checks people do write are the ones written after an incident, one per scar.
 * So the system proposes, and a person confirms.
 *
 * Every proposal carries the basis it was derived from and says so in the
 * review queue, because a reviewer approving forty checks in an afternoon
 * deserves to know which of them can establish that the workflow is correct and
 * which merely record what it has been doing. That distinction is invisible in
 * every tool that presents a learned baseline as a "check".
 *
 * These functions are deterministic and pure. The model-assisted proposer lives
 * in ./llm and produces exactly the same Proposal type, which is the point: a
 * model gets no privileged path to a green tick.
 */

import type { Assertion, AssertionParams, Basis, DegeneratePattern, Run } from './types';
import type { Sink } from './sinks';
import type { N8nWorkflowDoc } from '../graph/hash';
import { inferCadence } from '../verify/cadence';

export interface Proposal {
  readonly assertion: Assertion;
  /** Why this is being suggested, written for the person reviewing it. */
  readonly rationale: string;
  readonly confidence: 'low' | 'moderate' | 'high';
  readonly derivedFrom:
    | { readonly kind: 'structure'; readonly workflowHash: string }
    | { readonly kind: 'observation'; readonly runIds: readonly string[]; readonly sampleSize: number }
    | { readonly kind: 'intent'; readonly proposedBy: string };
}

let counter = 0;
function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

function makeAssertion(
  workflowId: string,
  sinkId: string,
  basis: Basis,
  statement: string,
  params: AssertionParams,
): Assertion {
  return {
    id: nextId('as'),
    workflowId,
    sinkId,
    kind: params.kind,
    basis,
    statement,
    params,
    status: 'proposed',
    createdAt: new Date().toISOString(),
  };
}

/**
 * What the graph itself promises.
 *
 * Basis `structure`: these prove the workflow does what its own definition says.
 * They cannot prove the definition was right, and the review queue says so.
 */
export function proposeFromStructure(
  workflowId: string,
  workflowHash: string,
  sinks: readonly Sink[],
): readonly Proposal[] {
  const out: Proposal[] = [];

  for (const sink of sinks) {
    out.push({
      assertion: makeAssertion(
        workflowId,
        sink.nodeId,
        'structure',
        `"${sink.nodeName}" produces at least one item on every run`,
        { kind: 'non-empty' },
      ),
      rationale: sink.rationale,
      confidence: sink.terminal ? 'high' : 'moderate',
      derivedFrom: { kind: 'structure', workflowHash },
    });

    // Anything a model wrote can come back shaped perfectly and saying nothing,
    // or saying it would rather not. Those two cases are worth their own check
    // wherever generated text leaves the system.
    if (sink.category === 'ai-generation' || sink.category === 'email' || sink.category === 'messaging') {
      out.push({
        assertion: makeAssertion(
          workflowId,
          sink.nodeId,
          'structure',
          `"${sink.nodeName}" never sends an empty, unrendered or refused message`,
          {
            kind: 'not-degenerate',
            fields: [],
            patterns: ['empty-string', 'unrendered-template', 'model-refusal', 'error-text-in-value', 'null-literal'],
          },
        ),
        rationale:
          sink.category === 'ai-generation'
            ? 'Generated text fails in ways a status code cannot express: the model declines, or a template variable never resolved and the placeholder ships as-is.'
            : 'This step delivers text to a person. An unrendered "{{ $json.firstName }}" reaching a customer is a visible failure that the platform records as a success.',
        confidence: 'high',
        derivedFrom: { kind: 'structure', workflowHash },
      });
    }
  }

  return out;
}

interface FieldStat {
  readonly field: string;
  readonly presentIn: number;
  readonly nullIn: number;
  readonly stringIn: number;
  readonly meanLength: number;
}

/** Flatten the top two levels of an item into dot paths, which is where real payloads live. */
function pathsOf(item: unknown, prefix = '', depth = 0): Array<{ path: string; value: unknown }> {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
  const out: Array<{ path: string; value: unknown }> = [];
  for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push({ path, value: v });
    if (depth < 1 && v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...pathsOf(v, path, depth + 1));
    }
  }
  return out;
}

function fieldStats(items: readonly unknown[]): readonly FieldStat[] {
  const acc = new Map<string, { present: number; nulls: number; strings: number; totalLen: number }>();
  for (const item of items) {
    for (const { path, value } of pathsOf(item)) {
      const e = acc.get(path) ?? { present: 0, nulls: 0, strings: 0, totalLen: 0 };
      e.present += 1;
      if (value === null || value === undefined) e.nulls += 1;
      if (typeof value === 'string') {
        e.strings += 1;
        e.totalLen += value.length;
      }
      acc.set(path, e);
    }
  }
  return [...acc.entries()]
    .map(([field, e]) => ({
      field,
      presentIn: e.present,
      nullIn: e.nulls,
      stringIn: e.strings,
      meanLength: e.strings > 0 ? e.totalLen / e.strings : 0,
    }))
    .sort((a, b) => b.presentIn - a.presentIn);
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const MIN_RUNS_FOR_OBSERVATION = 10;
/** A field has to be near-universal before its absence is treated as a defect. */
const FIELD_UBIQUITY_THRESHOLD = 0.98;

/**
 * What the workflow has been doing.
 *
 * Basis `observation`: every proposal here is circular until a human attests
 * that the window it was learned from was good. They are still worth making,
 * because change detection is genuinely useful, but they are labelled honestly
 * and the confirmation gate will not let them through on a shrug.
 */
export function proposeFromObservation(
  workflowId: string,
  sinks: readonly Sink[],
  runs: readonly Run[],
): readonly Proposal[] {
  const out: Proposal[] = [];
  const successful = runs.filter((r) => r.platformStatus === 'success');
  if (successful.length < MIN_RUNS_FOR_OBSERVATION) return out;

  const runIds = successful.map((r) => r.id);

  for (const sink of sinks) {
    const counts: number[] = [];
    const allItems: unknown[] = [];
    let runsWithCapture = 0;

    for (const run of successful) {
      const items = run.sinkOutputs[sink.nodeId];
      if (items === undefined) continue;
      runsWithCapture += 1;
      counts.push(items.length);
      allItems.push(...items);
    }

    if (runsWithCapture < MIN_RUNS_FOR_OBSERVATION) continue;

    // Volume envelope. Deliberately wider than the observed range: the point is
    // to catch a collapse or a runaway, not to relitigate ordinary variation.
    const sorted = [...counts].sort((a, b) => a - b);
    const p05 = quantile(sorted, 0.05);
    const p95 = quantile(sorted, 0.95);
    const min = Math.max(0, Math.floor(p05 * 0.5));
    const max = Math.ceil(Math.max(p95 * 2, p95 + 5));
    const everyRunHadItems = sorted[0]! > 0;

    if (everyRunHadItems) {
      out.push({
        assertion: makeAssertion(
          workflowId,
          sink.nodeId,
          'observation',
          `"${sink.nodeName}" produces between ${Math.max(1, min)} and ${max} items per run`,
          { kind: 'volume', min: Math.max(1, min), max },
        ),
        rationale: `Across ${runsWithCapture} successful runs this step produced between ${sorted[0]} and ${sorted[sorted.length - 1]} items, typically ${Math.round(quantile(sorted, 0.5))}. The bounds are set wide, so this catches a collapse or a runaway rather than ordinary variation.`,
        confidence: runsWithCapture >= 30 ? 'high' : 'moderate',
        derivedFrom: { kind: 'observation', runIds, sampleSize: runsWithCapture },
      });
    }

    // Shape, from fields that are effectively always present.
    const stats = fieldStats(allItems);
    const ubiquitous = stats.filter((s) => allItems.length > 0 && s.presentIn / allItems.length >= FIELD_UBIQUITY_THRESHOLD && s.nullIn === 0);
    const shapeFields = ubiquitous.slice(0, 8).map((s) => s.field);
    if (shapeFields.length > 0 && allItems.length >= 20) {
      out.push({
        assertion: makeAssertion(
          workflowId,
          sink.nodeId,
          'observation',
          `Every item from "${sink.nodeName}" carries ${shapeFields.map((f) => `"${f}"`).join(', ')}`,
          { kind: 'shape', fields: shapeFields },
        ),
        rationale: `These fields were present and non-null on ${Math.round((ubiquitous[0]!.presentIn / allItems.length) * 100)}% or more of ${allItems.length} captured items. A field that silently stops arriving is one of the commonest causes of downstream rows that look filled in and are not.`,
        confidence: allItems.length >= 100 ? 'high' : 'moderate',
        derivedFrom: { kind: 'observation', runIds, sampleSize: allItems.length },
      });
    }

    // Text fields worth guarding against degenerate content.
    const textFields = stats
      .filter((s) => s.stringIn > 0 && s.stringIn / Math.max(1, s.presentIn) > 0.8 && s.meanLength >= 15)
      .slice(0, 6)
      .map((s) => s.field);
    if (textFields.length > 0) {
      const patterns: DegeneratePattern[] = ['empty-string', 'unrendered-template', 'error-text-in-value', 'null-literal'];
      if (sink.category === 'ai-generation' || sink.category === 'email' || sink.category === 'messaging') {
        patterns.push('model-refusal');
      }
      out.push({
        assertion: makeAssertion(
          workflowId,
          sink.nodeId,
          'observation',
          `Text from "${sink.nodeName}" is never empty, unrendered or an error string`,
          { kind: 'not-degenerate', fields: textFields, patterns },
        ),
        rationale: `${textFields.length} field(s) here carry prose averaging ${Math.round(stats.find((s) => s.field === textFields[0])?.meanLength ?? 0)} characters. Those are the fields where "[object Object]", an unresolved "{{ }}" or a model refusal will pass through unnoticed.`,
        confidence: 'moderate',
        derivedFrom: { kind: 'observation', runIds, sampleSize: allItems.length },
      });
    }
  }

  // Cadence is about the workflow rather than any one sink.
  const profile = inferCadence(successful);
  if (profile) {
    const expect = profile.p95IntervalSeconds;
    const grace = Math.max(profile.medianIntervalSeconds, Math.round(expect * 0.5));
    out.push({
      assertion: makeAssertion(
        workflowId,
        '*',
        'observation',
        `This workflow runs at least every ${humaniseSeconds(expect)}`,
        { kind: 'cadence', expectEverySeconds: expect, graceSeconds: grace },
      ),
      rationale: `${profile.reasoning} A workflow that stops firing writes no execution and raises no error, so without this check its disappearance is invisible.`,
      confidence: profile.confidence,
      derivedFrom: { kind: 'observation', runIds, sampleSize: profile.sampleSize },
    });
  }

  return out;
}

function humaniseSeconds(s: number): string {
  if (s < 90) return `${Math.round(s)} seconds`;
  if (s < 5400) return `${Math.round(s / 60)} minutes`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} hours`;
  return `${(s / 86400).toFixed(1)} days`;
}

/**
 * Everything the deterministic proposers can offer for one workflow.
 *
 * Intent-basis proposals are not produced here, because intent cannot be
 * derived from the artefact. It has to be stated by someone who knows what the
 * workflow is for, either directly or with a model reading the graph and asking
 * (see ./llm). That is not a limitation to work around; it is the reason the
 * output of this system means anything.
 */
export function proposeAll(args: {
  readonly workflowId: string;
  readonly workflowHash: string;
  readonly doc: N8nWorkflowDoc;
  readonly sinks: readonly Sink[];
  readonly runs: readonly Run[];
}): readonly Proposal[] {
  return [
    ...proposeFromStructure(args.workflowId, args.workflowHash, args.sinks),
    ...proposeFromObservation(args.workflowId, args.sinks, args.runs),
  ];
}
