/**
 * A first draft of a contract, inferred from a batch.
 *
 * Inference only proposes. Every line it writes is something the batch already
 * does consistently, phrased as a rule, for a person to keep, cut or tighten.
 * The `attests` line is left as a placeholder on purpose: the one thing that
 * cannot be inferred is who is willing to stand behind the rules.
 */

import { extractAtoms, type AtomKind } from '../verify/grounding';
import { promptSha } from './contract';
import type { TaskRecord } from './record';

const KINDS_OF_INTEREST: readonly AtomKind[] = ['money', 'date', 'identifier', 'email', 'url'];

export interface DraftOptions {
  readonly pipeline?: string;
  /** Path and text of a prompt to bind the contract to. */
  readonly prompt?: { readonly path: string; readonly text: string };
}

export function draftContract(records: readonly TaskRecord[], pipelineOrOpts: string | DraftOptions = 'pipeline'): string {
  const opts: DraftOptions = typeof pipelineOrOpts === 'string' ? { pipeline: pipelineOrOpts } : pipelineOrOpts;
  const pipeline = opts.pipeline ?? 'pipeline';
  const n = records.length;
  const withOutput = records.filter((r) => r.output.trim().length > 0);
  const anySources = records.some((r) => r.sources.length > 0);

  // A kind is "always present" if it shows up in nearly every non-empty answer.
  const present: Record<string, number> = {};
  for (const r of withOutput) {
    const kinds = new Set(extractAtoms(r.output).map((a) => a.kind));
    for (const k of KINDS_OF_INTEREST) if (kinds.has(k)) present[k] = (present[k] ?? 0) + 1;
  }
  const always = KINDS_OF_INTEREST.filter((k) => withOutput.length >= 3 && (present[k] ?? 0) >= withOutput.length * 0.9);

  const groundKinds = KINDS_OF_INTEREST.filter((k) => (present[k] ?? 0) >= Math.max(2, withOutput.length * 0.5));

  const lines: string[] = [];
  lines.push(`pipeline: ${pipeline}`);
  lines.push('basis: intent');
  lines.push('attests: "TODO: your name, the date, and how you know these rules are what this pipeline is contracted to do"');
  if (opts.prompt) {
    lines.push('bound_to:');
    lines.push(`  prompt: ${opts.prompt.path}`);
    lines.push(`  prompt_sha: ${promptSha(opts.prompt.text)}   # regenerate this line whenever the prompt legitimately changes`);
  }
  lines.push('');

  if (always.length > 0 || groundKinds.length > 0 || anySources) {
    lines.push('output:');
    if (always.length > 0) {
      lines.push('  must_contain:');
      for (const k of always) lines.push(`    - kind: ${k}          # every answer in the sample had one`);
    }
    if (anySources && groundKinds.length > 0) {
      lines.push('  grounded:');
      lines.push(`    kinds: [${groundKinds.join(', ')}]`);
    }
    // A conservative money predicate if amounts appear on both sides.
    if ((present.money ?? 0) >= 2 && records.some((r) => r.sources.join(' ').match(/[£$€¥]\s?\d|\d\s?(?:USD|GBP|EUR)/))) {
      lines.push('  predicates:');
      lines.push('    - "money <= source.money.max"   # no answer quoted more than the largest figure in its source');
    }
    lines.push('');
  }

  lines.push('# consistency: true          # uncomment to fold the internal-consistency check into this contract');
  lines.push('');
  lines.push(`# Drafted from ${n} task(s). Nothing here is live until you edit it and fill in "attests".`);

  return lines.join('\n') + '\n';
}
