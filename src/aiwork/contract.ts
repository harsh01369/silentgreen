/**
 * The contract layer.
 *
 * Tier 0 checks need nothing from the user. A contract is the first thing they
 * write down: a short file that says what this pipeline is actually for, so the
 * verdict can be about the job and not just about the text.
 *
 * It stays inside the same rule as everything else here. Every clause is a
 * deterministic comparison. `must_contain: {kind: money}` asks whether the
 * extractor found a money atom, not whether a model thinks the answer is
 * complete. `currency == source.currency` compares two tokens. No clause
 * consults a model, and every clause returns one of the three verdicts.
 *
 * The `attests` line is mandatory and is printed next to every result the
 * contract produces, because a rule nobody will put their name to is a rule
 * nobody should be trusting.
 */

import { createHash } from 'node:crypto';
import { parseYaml, type YamlValue } from '../util/yaml';
import { extractAtoms, checkGrounding, type AtomKind } from '../verify/grounding';
import { checkConsistency } from '../verify/consistency';
import { groundingSourcesFor, type TaskRecord } from './record';

export type ContractBasis = 'intent' | 'structure' | 'observation';
export type ClauseVerdict = 'proven' | 'violated' | 'unproven';

export interface MustContain {
  readonly kind?: AtomKind;
  readonly pattern?: string;
}

export interface ActionRule {
  /** A regex. When the output matches, the required action must be present. */
  readonly when: string;
  readonly require: {
    readonly kind: string;
    /** `source.email`, `source.url`, or a literal regex the target must match. */
    readonly target_matches?: string;
  };
}

export interface Contract {
  readonly pipeline: string;
  readonly basis: ContractBasis;
  readonly attests: string;
  /**
   * The prompt or instruction file this contract was confirmed against, and a
   * hash of it at that moment. When `check` is given the current prompt and it
   * no longer matches, every result this contract would call `proven` becomes
   * `unproven`: the thing the rules were written for has changed underneath
   * them, and a green result about a prompt that no longer exists is exactly
   * what this tool refuses to give.
   */
  readonly bound_to?: { readonly prompt: string; readonly prompt_sha: string };
  readonly output?: {
    readonly must_contain?: readonly MustContain[];
    readonly must_not_contain?: readonly MustContain[];
    readonly grounded?: { readonly kinds?: readonly AtomKind[] };
    readonly predicates?: readonly string[];
  };
  readonly actions?: readonly ActionRule[];
  readonly consistency?: boolean;
}

export function promptSha(text: string): string {
  // A prompt is words. Every run of whitespace collapses to one space, so a
  // reflow, a re-indent or a trailing newline is not read as a change; a
  // changed word is.
  return createHash('sha256').update(text.replace(/\s+/g, ' ').trim()).digest('hex');
}

export interface ClauseOutcome {
  readonly clause: string;
  readonly verdict: ClauseVerdict;
  readonly detail: string;
  readonly evidence?: string;
}

export interface ContractTaskResult {
  readonly id: string;
  readonly verdict: ClauseVerdict;
  readonly clauses: readonly ClauseOutcome[];
}

export interface ContractReport {
  readonly contract: Contract;
  readonly tasks: readonly ContractTaskResult[];
  readonly summary: {
    readonly proven: number;
    readonly violated: number;
    readonly unproven: number;
    readonly byClause: Readonly<Record<string, { proven: number; violated: number; unproven: number }>>;
  };
  /** The coverage-honesty sentence for this contract. */
  readonly honesty: string;
  /** True when the bound prompt has changed since the contract was confirmed. */
  readonly stale: boolean;
  readonly staleReason?: string;
}

export interface EvaluateOptions {
  /** The current text of the prompt the contract is `bound_to`, to check for drift. */
  readonly promptText?: string;
}

/* --------------------------------------------------------------- parsing --- */

const ATOM_KINDS = new Set<AtomKind>(['number', 'money', 'date', 'email', 'url', 'identifier', 'quote', 'name']);

export function parseContract(text: string, filename = 'contract'): { contract?: Contract; errors: readonly string[] } {
  const isJson = filename.endsWith('.json') || text.trimStart().startsWith('{');
  let root: YamlValue | undefined;
  const errors: string[] = [];

  if (isJson) {
    try {
      root = JSON.parse(text) as YamlValue;
    } catch (err) {
      return { errors: [`${filename}: not valid JSON: ${String(err)}`] };
    }
  } else {
    const y = parseYaml(text);
    if (y.errors.length > 0) return { errors: y.errors.map((e) => `${filename}: ${e}`) };
    root = y.value;
  }

  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return { errors: [`${filename}: the top level must be a mapping with at least "pipeline", "basis" and "attests"`] };
  }
  const obj = root as Record<string, YamlValue>;

  const pipeline = typeof obj.pipeline === 'string' ? obj.pipeline.trim() : '';
  if (!pipeline) errors.push(`${filename}: "pipeline" is required and must name the pipeline this contract governs`);

  const basis = obj.basis;
  if (basis !== 'intent' && basis !== 'structure' && basis !== 'observation') {
    errors.push(`${filename}: "basis" is required and must be one of intent, structure, observation`);
  }

  const attests = typeof obj.attests === 'string' ? obj.attests.trim() : '';
  if (attests.length < 12 || attests.split(/\s+/).length < 3) {
    errors.push(
      `${filename}: "attests" is required and must be a real sentence saying who is standing behind these rules and on what date. It is printed next to every result.`,
    );
  } else if (/^todo\b/i.test(attests) || /your name, the date/i.test(attests)) {
    errors.push(`${filename}: "attests" is still the placeholder from the draft. Replace it with who is standing behind these rules and how they know.`);
  }

  let bound: Contract['bound_to'];
  if (obj.bound_to && typeof obj.bound_to === 'object' && !Array.isArray(obj.bound_to)) {
    const bt = obj.bound_to as Record<string, YamlValue>;
    if (typeof bt.prompt === 'string' && typeof bt.prompt_sha === 'string') {
      bound = { prompt: bt.prompt, prompt_sha: bt.prompt_sha };
    } else {
      errors.push(`${filename}: "bound_to" needs both "prompt" (a path) and "prompt_sha" (the hash it was confirmed against)`);
    }
  }

  const out = obj.output;
  const output: NonNullable<Contract['output']> = {};
  if (out && typeof out === 'object' && !Array.isArray(out)) {
    const o = out as Record<string, YamlValue>;
    if (Array.isArray(o.must_contain)) (output as { must_contain?: MustContain[] }).must_contain = o.must_contain.map((m) => readMustContain(m, filename, errors));
    if (Array.isArray(o.must_not_contain))
      (output as { must_not_contain?: MustContain[] }).must_not_contain = o.must_not_contain.map((m) => readMustContain(m, filename, errors));
    if (o.grounded && typeof o.grounded === 'object' && !Array.isArray(o.grounded)) {
      const g = o.grounded as Record<string, YamlValue>;
      const kinds = Array.isArray(g.kinds) ? g.kinds.filter((k): k is AtomKind => typeof k === 'string' && ATOM_KINDS.has(k as AtomKind)) : undefined;
      (output as { grounded?: { kinds?: readonly AtomKind[] } }).grounded = kinds ? { kinds } : {};
    }
    if (Array.isArray(o.predicates))
      (output as { predicates?: string[] }).predicates = o.predicates.filter((p): p is string => typeof p === 'string');
  }

  const actions: ActionRule[] = [];
  if (Array.isArray(obj.actions)) {
    for (const a of obj.actions) {
      if (!a || typeof a !== 'object' || Array.isArray(a)) continue;
      const ar = a as Record<string, YamlValue>;
      const when = typeof ar.when === 'string' ? ar.when : '';
      const req = ar.require;
      if (!when || !req || typeof req !== 'object' || Array.isArray(req)) {
        errors.push(`${filename}: each entry under "actions" needs a "when" regex and a "require" with a "kind"`);
        continue;
      }
      const rr = req as Record<string, YamlValue>;
      if (typeof rr.kind !== 'string') {
        errors.push(`${filename}: an action rule "require" needs a "kind" such as email.sent`);
        continue;
      }
      actions.push({
        when,
        require: {
          kind: rr.kind,
          ...(typeof rr.target_matches === 'string' ? { target_matches: rr.target_matches } : {}),
        },
      });
    }
  }

  if (errors.length > 0) return { errors };

  const contract: Contract = {
    pipeline,
    basis: basis as ContractBasis,
    attests,
    ...(bound ? { bound_to: bound } : {}),
    ...(Object.keys(output).length > 0 ? { output } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    ...(obj.consistency === true ? { consistency: true } : {}),
  };
  return { contract, errors: [] };
}

function readMustContain(m: YamlValue, filename: string, errors: string[]): MustContain {
  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    errors.push(`${filename}: each must_contain / must_not_contain entry is "kind: <atom kind>" or "pattern: <regex>"`);
    return {};
  }
  const mm = m as Record<string, YamlValue>;
  if (typeof mm.kind === 'string') {
    if (!ATOM_KINDS.has(mm.kind as AtomKind)) errors.push(`${filename}: "${mm.kind}" is not a known atom kind`);
    return { kind: mm.kind as AtomKind };
  }
  if (typeof mm.pattern === 'string') return { pattern: mm.pattern };
  errors.push(`${filename}: a must_contain entry needs "kind" or "pattern"`);
  return {};
}

/* ------------------------------------------------------------ evaluation --- */

const CURRENCY = /\b(?:USD|GBP|EUR|INR|JPY|AUD|CAD|CHF)\b|[$£€¥₹]/g;

function moneyValues(text: string): number[] {
  return extractAtoms(text)
    .filter((a) => a.kind === 'money' || a.kind === 'number')
    .map((a) => Number(a.key))
    .filter((n) => Number.isFinite(n));
}

function dateValues(text: string): string[] {
  return extractAtoms(text)
    .filter((a) => a.kind === 'date')
    .map((a) => a.key)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
}

function currencyTokens(text: string): Set<string> {
  const map: Record<string, string> = { $: 'USD', '£': 'GBP', '€': 'EUR', '¥': 'JPY', '₹': 'INR' };
  const out = new Set<string>();
  for (const m of text.matchAll(CURRENCY)) out.add(map[m[0]] ?? m[0].toUpperCase());
  return out;
}

function evalPredicate(pred: string, output: string, source: string, at: string | undefined): ClauseOutcome {
  const clause = `predicate: ${pred}`;
  const p = pred.trim();

  // date within N days
  let m = p.match(/^date\s+within\s+(\d+)\s*days?$/i);
  if (m) {
    const days = Number(m[1]);
    const dates = dateValues(output);
    if (dates.length === 0) return { clause, verdict: 'unproven', detail: 'the answer states no date, so this cannot be checked' };
    const base = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();
    for (const d of dates) {
      const diff = (Date.parse(d) - base.getTime()) / 86_400_000;
      if (diff < -1 || diff > days) {
        return { clause, verdict: 'violated', detail: `${d} is ${Math.round(diff)} days from the task date, outside the ${days}-day window`, evidence: d };
      }
    }
    return { clause, verdict: 'proven', detail: `every date in the answer is within ${days} days`, evidence: dates.join(', ') };
  }

  // currency == source.currency
  if (/^currency\s*==\s*source\.currency$/i.test(p)) {
    const outC = currencyTokens(output);
    const srcC = currencyTokens(source);
    if (outC.size === 0 || srcC.size === 0) return { clause, verdict: 'unproven', detail: 'a currency could not be read on one side' };
    const mismatch = [...outC].filter((c) => !srcC.has(c));
    return mismatch.length > 0
      ? { clause, verdict: 'violated', detail: `the answer uses ${mismatch.join(', ')}, which the source does not`, evidence: [...outC].join(', ') }
      : { clause, verdict: 'proven', detail: `currency matches the source (${[...outC].join(', ')})` };
  }

  // money <op> source.money.max | source.money.min | <number>
  m = p.match(/^(money|total|subtotal|tax)\s*(<=|>=|<|>|==|!=)\s*(source\.money\.(?:max|min)|-?\d[\d,]*(?:\.\d+)?)$/i);
  if (m) {
    const [, , op, rhsRaw] = m;
    const outVals = moneyValues(output);
    if (outVals.length === 0) return { clause, verdict: 'unproven', detail: 'the answer states no amount, so this cannot be checked' };
    let rhs: number;
    if (/^source\.money\.max$/i.test(rhsRaw!)) {
      const s = moneyValues(source);
      if (s.length === 0) return { clause, verdict: 'unproven', detail: 'the source states no amount to compare against' };
      rhs = Math.max(...s);
    } else if (/^source\.money\.min$/i.test(rhsRaw!)) {
      const s = moneyValues(source);
      if (s.length === 0) return { clause, verdict: 'unproven', detail: 'the source states no amount to compare against' };
      rhs = Math.min(...s);
    } else {
      rhs = Number(rhsRaw!.replace(/,/g, ''));
    }
    const bad = outVals.filter((v) => !compare(v, op!, rhs));
    return bad.length > 0
      ? { clause, verdict: 'violated', detail: `${bad.join(', ')} fail ${op} ${rhs}`, evidence: bad.join(', ') }
      : { clause, verdict: 'proven', detail: `every amount satisfies ${op} ${rhs}` };
  }

  return { clause, verdict: 'unproven', detail: 'this predicate form is not recognised, so it was not evaluated' };
}

function compare(a: number, op: string, b: number): boolean {
  switch (op) {
    case '<':
      return a < b;
    case '<=':
      return a <= b + 1e-9;
    case '>':
      return a > b;
    case '>=':
      return a >= b - 1e-9;
    case '==':
      return Math.abs(a - b) < 1e-9;
    case '!=':
      return Math.abs(a - b) >= 1e-9;
    default:
      return false;
  }
}

function worst(verdicts: readonly ClauseVerdict[]): ClauseVerdict {
  if (verdicts.includes('violated')) return 'violated';
  if (verdicts.includes('unproven')) return 'unproven';
  return 'proven';
}

export function evaluateContract(
  contract: Contract,
  records: readonly TaskRecord[],
  opts: EvaluateOptions = {},
): ContractReport {
  const tasks: ContractTaskResult[] = [];
  const byClause: Record<string, { proven: number; violated: number; unproven: number }> = {};
  const tally = (c: string, v: ClauseVerdict) => {
    (byClause[c] ??= { proven: 0, violated: 0, unproven: 0 })[v] += 1;
  };

  // Prompt drift: if the contract is bound to a prompt and we were handed the
  // current one, and it no longer matches, nothing this contract says can be
  // called proven until it is re-confirmed against the new prompt.
  let stale = false;
  let staleReason: string | undefined;
  if (contract.bound_to && opts.promptText !== undefined) {
    if (promptSha(opts.promptText) !== contract.bound_to.prompt_sha) {
      stale = true;
      staleReason = `The prompt this contract was confirmed against (${contract.bound_to.prompt}) has changed. Its rules may no longer describe what the pipeline is for, so every result it would call proven is reported as unproven until someone re-confirms it against the new prompt.`;
    }
  }
  const degrade = (v: ClauseVerdict): ClauseVerdict => (stale && v === 'proven' ? 'unproven' : v);

  for (const record of records) {
    const clauses: ClauseOutcome[] = [];
    const { sources, basis: srcBasis } = groundingSourcesFor(record);
    const source = sources.join('\n');

    for (const mc of contract.output?.must_contain ?? []) {
      const clause = mc.kind ? `must contain a ${mc.kind}` : `must contain /${mc.pattern}/`;
      if (mc.kind) {
        const has = extractAtoms(record.output).some((a) => a.kind === mc.kind);
        clauses.push(
          has
            ? { clause, verdict: 'proven', detail: `an atom of kind ${mc.kind} is present` }
            : { clause, verdict: 'violated', detail: `the contract requires a ${mc.kind} in every answer and this one has none` },
        );
      } else if (mc.pattern) {
        const ok = safeRe(mc.pattern).test(record.output);
        clauses.push(
          ok
            ? { clause, verdict: 'proven', detail: 'the required pattern is present' }
            : { clause, verdict: 'violated', detail: 'the required pattern is absent' },
        );
      }
    }

    for (const mc of contract.output?.must_not_contain ?? []) {
      const clause = mc.kind ? `must not contain a ${mc.kind}` : `must not contain /${mc.pattern}/`;
      if (mc.pattern) {
        const hit = safeRe(mc.pattern).exec(record.output);
        clauses.push(
          hit
            ? { clause, verdict: 'violated', detail: 'a forbidden pattern appears in the answer', evidence: hit[0] }
            : { clause, verdict: 'proven', detail: 'the forbidden pattern is absent' },
        );
      } else if (mc.kind) {
        const hit = extractAtoms(record.output).find((a) => a.kind === mc.kind);
        clauses.push(
          hit
            ? { clause, verdict: 'violated', detail: `a ${mc.kind} appears in the answer and the contract forbids it`, evidence: hit.text }
            : { clause, verdict: 'proven', detail: `no ${mc.kind} appears` },
        );
      }
    }

    if (contract.output?.grounded) {
      const clause = 'grounded in the source';
      const kinds = contract.output.grounded.kinds;
      if (srcBasis !== 'sources') {
        clauses.push({ clause, verdict: 'unproven', detail: 'no retrieved source material was captured for this task' });
      } else {
        const g = checkGrounding(record.output, sources, kinds ? { kinds } : {});
        if (g.inconclusive) clauses.push({ clause, verdict: 'unproven', detail: g.reason ?? 'too little to check' });
        else if (g.ungrounded.length > 0)
          clauses.push({
            clause,
            verdict: 'violated',
            detail: `${g.ungrounded.length} fact(s) in the answer are not in the source`,
            evidence: g.ungrounded.map((u) => u.text).join(', '),
          });
        else clauses.push({ clause, verdict: 'proven', detail: `${g.checked} fact(s) all trace to the source` });
      }
    }

    for (const pred of contract.output?.predicates ?? []) {
      clauses.push(evalPredicate(pred, record.output, source, record.at));
    }

    for (const rule of contract.actions ?? []) {
      const clause = `when /${rule.when}/: ${rule.require.kind}`;
      if (!safeRe(rule.when).test(record.output)) continue; // trigger not present, clause not applicable
      const actions = record.actions ?? [];
      if (record.actions === undefined) {
        clauses.push({
          clause,
          verdict: 'unproven',
          detail: 'the answer says this action was taken, but no actions were recorded for the task, so it cannot be confirmed either way',
        });
        continue;
      }
      const targetRe = resolveTargetMatcher(rule.require.target_matches, source);
      const match = actions.find(
        (a) => a.kind === rule.require.kind && (!targetRe || (a.target !== undefined && targetRe.test(a.target))),
      );
      clauses.push(
        match
          ? { clause, verdict: 'proven', detail: `a matching ${rule.require.kind} action is recorded`, evidence: match.target }
          : {
              clause,
              verdict: 'violated',
              detail: `the answer describes ${rule.require.kind} but no matching action was recorded`,
              evidence: actions.map((a) => a.kind).join(', ') || 'no actions',
            },
      );
    }

    if (contract.consistency) {
      for (const bad of checkConsistency(record.output)) {
        clauses.push({ clause: `internal consistency: ${bad.kind}`, verdict: 'violated', detail: bad.summary, evidence: bad.evidence });
      }
    }

    const degraded = stale
      ? clauses.map((co) => (co.verdict === 'proven' ? { ...co, verdict: degrade(co.verdict), detail: `${co.detail} (held, but reported unproven: the bound prompt changed)` } : co))
      : clauses;
    for (const co of degraded) tally(co.clause, co.verdict);
    tasks.push({ id: record.id, verdict: worst(degraded.map((c) => c.verdict)), clauses: degraded });
  }

  const summary = {
    proven: tasks.filter((t) => t.verdict === 'proven').length,
    violated: tasks.filter((t) => t.verdict === 'violated').length,
    unproven: tasks.filter((t) => t.verdict === 'unproven').length,
    byClause,
  };

  const honesty =
    (stale ? `${staleReason} ` : '') +
    `These verdicts are measured against a contract on a ${contract.basis} basis. ` +
    (contract.basis === 'intent'
      ? 'A proven result means the work matches what a person wrote down that it is for. '
      : contract.basis === 'structure'
        ? 'A proven result means the work is consistent with how the system is built, not that the design is what the business needed. '
        : 'A proven result means the work is consistent with what the system used to do, which is not evidence it was ever correct. ') +
    `Attestation: ${contract.attests}`;

  return { contract, tasks, summary, honesty, stale, ...(staleReason ? { staleReason } : {}) };
}

function safeRe(pattern: string): RegExp {
  try {
    return new RegExp(pattern, 'i');
  } catch {
    return /$a/; // matches nothing
  }
}

function resolveTargetMatcher(spec: string | undefined, source: string): RegExp | undefined {
  if (!spec) return undefined;
  if (/^source\.email$/i.test(spec)) {
    const e = source.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
    return e ? new RegExp(escapeRe(e[0]), 'i') : /$a/;
  }
  if (/^source\.url$/i.test(spec)) {
    const u = source.match(/\bhttps?:\/\/[^\s"'<>)\]]+/);
    return u ? new RegExp(escapeRe(u[0]), 'i') : /$a/;
  }
  return safeRe(spec);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
