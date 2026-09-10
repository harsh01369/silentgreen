/**
 * One task, laid out for a person to read side by side.
 *
 * The answer on the left with every checkable atom marked: green where it
 * traces to the source, an oxidised underline where it appears nowhere, with
 * the reason under each one. The source on the right with the figures the
 * answer got right lit up, so a reviewer can see the match rather than take it
 * on trust.
 *
 * Pure. It runs the same groundedness check the rest of the engine runs and
 * then arranges the result; it decides nothing a model could have decided.
 */

import { checkGrounding, extractAtoms, type Atom, type AtomKind } from './grounding';
import { groundingSourcesFor, type TaskRecord } from '../aiwork/record';

export type SegmentKind = 'plain' | 'grounded' | 'ungrounded';

export interface AnswerSegment {
  readonly text: string;
  readonly kind: SegmentKind;
  readonly atomKind?: AtomKind;
  /** For an ungrounded segment: the sentence a reviewer needs. */
  readonly why?: string;
}

export interface SourceHighlight {
  readonly start: number;
  readonly end: number;
  readonly atomKind: AtomKind;
  readonly text: string;
}

export interface QuoteFinding {
  readonly text: string;
  readonly grounded: boolean;
}

export interface TaskInspection {
  readonly id: string;
  readonly answer: string;
  readonly segments: readonly AnswerSegment[];
  readonly source: string;
  readonly sourceHighlights: readonly SourceHighlight[];
  readonly quotes: readonly QuoteFinding[];
  readonly counts: { readonly grounded: number; readonly ungrounded: number; readonly checked: number };
  readonly basis: 'sources' | 'prompt' | 'none';
  readonly note?: string;
  /** True when there was too little to check for the layout to mean much. */
  readonly inconclusive: boolean;
  readonly reason?: string;
}

/** Drop an atom from inline marking when another atom sits strictly inside it. */
function isContainer(a: Atom, all: readonly Atom[]): boolean {
  return all.some((b) => b !== a && b.start >= a.start && b.end <= a.end && b.end - b.start < a.end - a.start);
}

function firstIndexOf(haystack: string, needleRaw: string): number {
  const i = haystack.indexOf(needleRaw);
  if (i !== -1) return i;
  // fall back to a case-insensitive search
  const j = haystack.toLowerCase().indexOf(needleRaw.toLowerCase());
  return j;
}

export function inspectTask(record: TaskRecord): TaskInspection {
  const { sources, basis, note } = groundingSourcesFor(record);
  const source = sources.join('\n\n');
  const answer = record.output;
  const g = checkGrounding(answer, sources);

  const ungroundedKeys = new Map(g.ungrounded.map((u) => [`${u.kind}|${u.key}`, u.why]));
  const atoms = [...extractAtoms(answer)].sort((a, b) => a.start - b.start || b.end - a.end);
  const inline = atoms.filter((a) => a.kind !== 'quote' && !isContainer(a, atoms));

  const segments: AnswerSegment[] = [];
  let cursor = 0;
  for (const a of inline) {
    if (a.start < cursor) continue; // overlapping leftover, skip
    if (a.start > cursor) segments.push({ text: answer.slice(cursor, a.start), kind: 'plain' });
    const why = ungroundedKeys.get(`${a.kind}|${a.key}`);
    segments.push(
      why
        ? { text: answer.slice(a.start, a.end), kind: 'ungrounded', atomKind: a.kind, why }
        : { text: answer.slice(a.start, a.end), kind: 'grounded', atomKind: a.kind },
    );
    cursor = a.end;
  }
  if (cursor < answer.length) segments.push({ text: answer.slice(cursor), kind: 'plain' });

  // Where the grounded atoms appear in the source, so the reviewer sees the match.
  const highlights: SourceHighlight[] = [];
  if (source) {
    for (const a of inline) {
      if (ungroundedKeys.has(`${a.kind}|${a.key}`)) continue;
      const at = firstIndexOf(source, a.text);
      if (at !== -1 && !highlights.some((h) => at < h.end && at + a.text.length > h.start)) {
        highlights.push({ start: at, end: at + a.text.length, atomKind: a.kind, text: source.slice(at, at + a.text.length) });
      }
    }
    highlights.sort((x, y) => x.start - y.start);
  }

  const quotes: QuoteFinding[] = atoms
    .filter((a) => a.kind === 'quote')
    .map((a) => ({ text: a.text, grounded: !ungroundedKeys.has(`quote|${a.key}`) }));

  const groundedCount = g.checked - g.ungrounded.length;

  return {
    id: record.id,
    answer,
    segments,
    source,
    sourceHighlights: highlights,
    quotes,
    counts: { grounded: groundedCount, ungrounded: g.ungrounded.length, checked: g.checked },
    basis,
    ...(note ? { note } : {}),
    inconclusive: g.inconclusive,
    ...(g.reason ? { reason: g.reason } : {}),
  };
}
