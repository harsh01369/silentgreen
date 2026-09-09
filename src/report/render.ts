/**
 * The client evidence report.
 *
 * This is the commercial artefact. The engineering exists so that this document
 * can be handed to somebody who is deciding whether to keep paying, and be true.
 *
 * Two rules shape it.
 *
 * It leads with what could not be established, not with what passed. Any report
 * that opens with a wall of green trains its reader to skim, and a reader who
 * skims cannot tell the difference between "we checked forty things" and "we
 * checked nothing and found no problems".
 *
 * It never converts an absence of findings into a claim of correctness. The
 * coverage sentence at the top says, in plain English, what this month's checks
 * are capable of proving, which for most workflows is "it has not changed"
 * rather than "it is right".
 */

import type { Assertion, AssertionResult } from '../contract/types';
import type { AuditResult, Violation } from '../audit';
import type { Ledger } from '../ledger/chain';

export interface ReportInput {
  readonly result: AuditResult;
  readonly assertions: readonly Assertion[];
  readonly ledger: Ledger;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly clientName: string;
  readonly preparedBy: string;
  readonly platform: { readonly executions: number; readonly succeeded: number; readonly failed: number; readonly sentence: string };
}

function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function date(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function dateTime(iso: string): string {
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

const UNPROVEN_EXPLANATIONS: Record<string, string> = {
  'no-assertions': 'no expectation has been written for this step',
  'only-proposed-assertions': 'an expectation exists but nobody has confirmed it, so it cannot raise anything',
  'contract-stale': 'the workflow changed after this expectation was confirmed, so it no longer describes what runs',
  'sink-not-captured': 'the platform did not retain this step&rsquo;s output for the run, so there was nothing to check against',
  'run-data-unavailable': 'the run data needed for this check was not available',
  'assertion-not-applicable': 'this expectation does not apply to this kind of run',
};

interface GroupedViolation {
  readonly assertionId: string;
  readonly statement: string;
  readonly basis: string;
  readonly count: number;
  readonly firstAt?: string;
  readonly lastAt?: string;
  readonly detail?: string;
  readonly evidence?: string;
}

function group(violations: readonly Violation[]): readonly GroupedViolation[] {
  const map = new Map<string, GroupedViolation>();
  for (const v of violations) {
    const prev = map.get(v.result.assertionId);
    if (!prev) {
      map.set(v.result.assertionId, {
        assertionId: v.result.assertionId,
        statement: v.result.statement,
        basis: v.result.basis,
        count: 1,
        firstAt: v.at,
        lastAt: v.at,
        detail: v.result.detail,
        evidence: v.result.evidence,
      });
    } else {
      map.set(v.result.assertionId, { ...prev, count: prev.count + 1, lastAt: v.at ?? prev.lastAt });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function basisNote(basis: string): string {
  switch (basis) {
    case 'intent':
      return 'stated business intent';
    case 'structure':
      return 'the workflow&rsquo;s own definition';
    case 'observation':
      return 'observed history, attested as a good baseline';
    default:
      return basis;
  }
}

export function renderReport(input: ReportInput): string {
  const { result, ledger, platform } = input;
  const violations = group(result.violations);
  const chain = ledger.verify();

  const unprovenRows = Object.entries(result.unprovenBreakdown).sort((a, b) => b[1] - a[1]);
  const totalChecks = result.counts.proven + result.counts.violated + result.counts.unproven;

  const confirmedByBasis = result.honesty.byBasis;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verification record: ${esc(input.clientName)}</title>
<style>
  :root {
    --ink: #16191d;
    --ink-soft: #4d545c;
    --rule: #d9dde2;
    --rule-soft: #eceff2;
    --paper: #ffffff;
    --shell: #f6f7f9;
    --violated: #9d1f27;
    --violated-bg: #fdf2f2;
    --unproven: #7d5200;
    --unproven-bg: #fdf8ec;
    --proven: #1c6141;
    --proven-bg: #f1f8f4;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--shell);
    color: var(--ink);
    font: 15px/1.6 ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .sheet { max-width: 860px; margin: 0 auto; background: var(--paper); padding: 56px 60px 72px; }
  h1 { font-size: 27px; line-height: 1.25; margin: 0 0 6px; letter-spacing: -0.01em; font-weight: 620; }
  h2 { font-size: 18px; margin: 44px 0 14px; font-weight: 620; letter-spacing: -0.005em; }
  h3 { font-size: 15px; margin: 0 0 4px; font-weight: 620; }
  p { margin: 0 0 12px; max-width: 68ch; }
  .meta { color: var(--ink-soft); font-size: 13.5px; margin-bottom: 26px; }
  .meta span + span::before { content: " / "; color: var(--rule); }
  .lede {
    font-size: 17px; line-height: 1.5; margin: 0 0 8px;
    border-left: 3px solid var(--ink); padding-left: 16px;
  }
  .counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--rule); border: 1px solid var(--rule); margin: 26px 0 8px; }
  .count { background: var(--paper); padding: 16px 18px; }
  .count b { display: block; font-size: 30px; line-height: 1.1; font-weight: 620; }
  .count small { color: var(--ink-soft); font-size: 13px; }
  .count.violated b { color: var(--violated); }
  .count.unproven b { color: var(--unproven); }
  .count.proven b { color: var(--proven); }
  .finding { border: 1px solid var(--rule); border-left: 3px solid var(--violated); background: var(--violated-bg); padding: 16px 18px; margin: 0 0 12px; }
  .finding .where { color: var(--ink-soft); font-size: 13.5px; margin: 2px 0 8px; }
  .evidence { background: var(--paper); border: 1px solid var(--rule); padding: 10px 12px; margin-top: 10px;
    font: 13px/1.5 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
  .evidence-label { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 4px; }
  .gap { border: 1px solid var(--rule); border-left: 3px solid var(--unproven); background: var(--unproven-bg); padding: 14px 18px; margin: 0 0 10px; }
  .ok { border: 1px solid var(--rule); border-left: 3px solid var(--proven); background: var(--proven-bg); padding: 14px 18px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
  th { font-weight: 620; border-bottom: 1px solid var(--rule); }
  td.num, th.num { text-align: right; width: 6em; }
  .note { color: var(--ink-soft); font-size: 13.5px; }
  footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--rule); color: var(--ink-soft); font-size: 13px; }
  code { font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--rule-soft); padding: 1px 4px; }
  @media (max-width: 720px) {
    .sheet { padding: 32px 22px 48px; }
    .counts { grid-template-columns: 1fr; }
  }
  @media print {
    body { background: #fff; }
    .sheet { padding: 0; max-width: none; }
  }
</style>
</head>
<body>
<div class="sheet">

  <h1>Verification record</h1>
  <p class="meta">
    <span>${esc(input.clientName)}</span>
    <span>${esc(result.workflowName)}</span>
    <span>${date(input.periodStart)} to ${date(input.periodEnd)}</span>
    <span>prepared by ${esc(input.preparedBy)}</span>
  </p>

  <p class="lede">${esc(result.headline)}</p>

  <p class="note">
    Over the same period the automation platform recorded ${platform.executions} executions,
    ${platform.succeeded} of them successful and ${platform.failed} failed. That count answers
    whether the code ran. It does not answer whether the work happened, which is what
    the rest of this document is about.
  </p>

  <div class="counts">
    <div class="count violated"><b>${result.counts.violated}</b><small>checks violated</small></div>
    <div class="count unproven"><b>${result.counts.unproven}</b><small>could not be established</small></div>
    <div class="count proven"><b>${result.counts.proven}</b><small>checks held</small></div>
  </div>
  <p class="note">${totalChecks} check evaluations across ${result.runsExamined} runs.</p>

  <h2>What this month&rsquo;s checks can and cannot prove</h2>
  <p>${esc(result.honesty.sentence)}</p>
  <table>
    <thead><tr><th>Basis of the expectation</th><th class="num">Live</th><th>What a green result means</th></tr></thead>
    <tbody>
      <tr><td>Stated business intent</td><td class="num">${confirmedByBasis.intent}</td><td>The workflow is doing the job somebody said it was for.</td></tr>
      <tr><td>The workflow&rsquo;s own definition</td><td class="num">${confirmedByBasis.structure}</td><td>The workflow is doing what its definition says. Whether the definition is right is a separate question.</td></tr>
      <tr><td>Observed history, with an attested baseline</td><td class="num">${confirmedByBasis.observation}</td><td>Behaviour has not changed since a period a named person confirmed was correct.</td></tr>
    </tbody>
  </table>

  ${
    violations.length > 0
      ? `<h2>What was caught (${violations.length})</h2>
  ${violations
    .map(
      (v) => `<div class="finding">
    <h3>${esc(v.statement)}</h3>
    <p class="where">${v.count} run${v.count === 1 ? '' : 's'}${v.firstAt ? `, first at ${esc(dateTime(v.firstAt))}` : ''}${v.lastAt && v.lastAt !== v.firstAt ? `, most recently ${esc(dateTime(v.lastAt))}` : ''} &middot; expectation derived from ${basisNote(v.basis)}</p>
    ${v.detail ? `<p>${esc(v.detail)}</p>` : ''}
    ${
      v.evidence
        ? `<div class="evidence-label">Captured value that decided it</div><div class="evidence">${esc(v.evidence)}</div>`
        : ''
    }
  </div>`,
    )
    .join('\n  ')}`
      : `<h2>What was caught</h2>
  <div class="ok"><h3>No confirmed expectation was violated in this period.</h3>
  <p class="note">That is a statement about the ${result.counts.proven} checks that ran, and nothing more. The section below lists what was not established.</p></div>`
  }

  ${
    unprovenRows.length > 0
      ? `<h2>What could not be established</h2>
  <p>These are not passes and they are not failures. They are the parts of this workflow
  that nothing verified, listed so that the coverage above is not mistaken for the whole picture.</p>
  ${unprovenRows
    .map(
      ([reason, count]) => `<div class="gap"><h3>${count} check${count === 1 ? '' : 's'}: ${UNPROVEN_EXPLANATIONS[reason] ?? esc(reason)}</h3></div>`,
    )
    .join('\n  ')}`
      : ''
  }

  ${
    result.drift.length > 0
      ? `<h2>Changes to the workflow in this period</h2>
  <p>Each of these invalidated any expectation confirmed against the previous revision,
  which is why some checks above read as unproven rather than continuing to report a
  result about a graph that no longer exists.</p>
  <ul>${result.drift.map((d) => `<li>${esc(d.description)}</li>`).join('')}</ul>`
      : ''
  }

  <h2>Record integrity</h2>
  <p>
    ${ledger.length} entries recorded in this period&rsquo;s evidence log, covering every
    expectation confirmed, who confirmed it, and every violation raised.
    ${
      chain.ok
        ? 'Each entry commits to the one before it, and the chain recomputes correctly, so no entry has been edited, backdated or removed since it was written.'
        : `<strong>The chain does not verify: ${esc(chain.brokenAt !== undefined ? chain.reason : 'unknown')}</strong> This report should not be relied on until that is explained.`
    }
  </p>
  <p class="note">
    This is a hash chain in a file held by whoever produced the report. It makes accidental
    corruption and casual editing detectable. It is not a claim against a determined operator
    who controls the file, and it is not presented as one.
  </p>

  <footer>
    Produced by silentgreen. Every figure above is derived from execution data captured
    from the automation platform, and every violation quotes the literal value that decided it.
    Checks that could not be evaluated are reported as unproven rather than counted as passes.
  </footer>

</div>
</body>
</html>`;
}

/** Convenience for tests: the plain-text spine of the report. */
export function reportSummaryLines(result: AuditResult): readonly string[] {
  return [
    result.headline,
    `violated ${result.counts.violated}`,
    `unproven ${result.counts.unproven}`,
    `proven ${result.counts.proven}`,
    result.honesty.sentence,
  ];
}

export type { AssertionResult };
