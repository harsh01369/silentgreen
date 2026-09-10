/**
 * The evidence record for a batch of AI work.
 *
 * This is the artefact an agency hands to a client, or to whoever is asking
 * whether the AI decisions going in front of customers were checked. It is a
 * single self-contained HTML file, printable, with no external assets and no
 * scripts.
 *
 * The same two rules as the automation report:
 *
 *   - It leads with what could not be established, not with what passed. A
 *     document that opens with a wall of green trains its reader to skim.
 *   - It never turns an absence of findings into a claim of correctness. The
 *     coverage sentence at the top says in plain English what these checks can
 *     and cannot prove.
 *
 * It carries a hash computed deterministically from the batch and the check
 * versions, so two people running the same batch produce byte-identical hashes,
 * and a changed report is a changed hash.
 */

import { createHash } from 'node:crypto';
import { checkBatch, type BatchSummary, type TaskResult } from './check';
import { groundingSourcesFor, type TaskRecord } from './record';
import type { ContractReport } from './contract';

export interface EvidenceReportInput {
  readonly records: readonly TaskRecord[];
  /** A label for this batch: a filename, a date range, a job id. */
  readonly batchLabel: string;
  readonly clientName?: string;
  readonly preparedBy?: string;
  readonly periodLabel?: string;
  readonly contract?: ContractReport;
  /** Keep the shape of each finding, not the value. Default true. */
  readonly redact?: boolean;
}

const CHECK_VERSION = 'silentgreen/checks@1';

function esc(s: unknown): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function redactEvidence(kind: string, evidence: string): string {
  const len = evidence.trim().length;
  if (kind === 'ungrounded') {
    const shape = /@/.test(evidence)
      ? 'an email address'
      : /https?:\/\//.test(evidence)
        ? 'a URL'
        : /[£$€¥]|\b(?:GBP|USD|EUR|INR)\b/.test(evidence)
          ? 'a monetary amount'
          : /^\d{4}-\d{2}-\d{2}/.test(evidence.trim())
            ? 'a date'
            : /^[A-Z0-9][A-Z0-9-]{3,}$/.test(evidence.trim())
              ? 'an identifier'
              : 'a value';
    return `${shape}, ${len} characters, absent from the source`;
  }
  return `${kind}, ${len} characters of output`;
}

/**
 * A stable fingerprint of the batch and what was checked. Deterministic: no
 * timestamps, no order dependence beyond the records themselves.
 */
export function evidenceHash(input: EvidenceReportInput, summary: BatchSummary): string {
  const material = JSON.stringify({
    v: CHECK_VERSION,
    label: input.batchLabel,
    tasks: input.records.map((r) => ({
      id: r.id,
      out: createHash('sha256').update(r.output).digest('hex'),
      src: createHash('sha256').update(groundingSourcesFor(r).sources.join('\n')).digest('hex'),
    })),
    result: { total: summary.total, clean: summary.clean, problematic: summary.problematic, inconclusive: summary.inconclusive, byKind: summary.byKind },
    contract: input.contract
      ? { pipeline: input.contract.contract.pipeline, stale: input.contract.stale, summary: input.contract.summary }
      : null,
  });
  return createHash('sha256').update(material).digest('hex');
}

const CSS = `
:root{--ink:#1a1c1a;--soft:#565853;--faint:#797b73;--rule:#c9c6ba;--traced:#2f6b4a;--absent:#9a3327;--withheld:#767871;--ground:#faf9f6}
*{box-sizing:border-box}
body{margin:0;background:#eceeeb;color:var(--ink);font:16px/1.6 Georgia,'Iowan Old Style',serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
main{max-width:46rem;margin:0 auto;padding:3rem 1.5rem 6rem;background:var(--ground);min-height:100vh}
h1{font-size:1.6rem;margin:0 0 .25rem;letter-spacing:-.01em}
h2{font-size:1.05rem;margin:2.5rem 0 .75rem;border-bottom:1px solid var(--rule);padding-bottom:.35rem}
.mono{font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;font-size:.8rem}
.meta{color:var(--faint);font-size:.85rem}
.lead{background:#fff;border:1px solid var(--rule);padding:1rem 1.15rem;margin:1.5rem 0;font-size:.95rem}
table{width:100%;border-collapse:collapse;margin:.5rem 0;font-size:.9rem}
td,th{text-align:left;padding:.4rem .5rem;border-bottom:1px solid var(--rule)}
th{color:var(--faint);font-weight:400;font-size:.8rem;text-transform:uppercase;letter-spacing:.03em}
.v-proven{color:var(--traced)}.v-violated{color:var(--absent)}.v-unproven{color:var(--withheld)}
.finding{border-left:3px solid var(--absent);padding:.5rem 0 .5rem .9rem;margin:.85rem 0}
.finding .id{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:.8rem;color:var(--faint)}
.signal{border-left:3px solid var(--withheld);padding:.35rem 0 .35rem .9rem;margin:.6rem 0;font-size:.9rem}
.stale{background:#fbeee9;border:1px solid var(--absent);padding:.75rem 1rem;margin:1rem 0;font-size:.9rem}
.hash{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:.72rem;word-break:break-all;color:var(--soft)}
.foot{margin-top:3rem;border-top:1px solid var(--rule);padding-top:1rem;color:var(--faint);font-size:.8rem}
@media print{body{background:#fff}main{padding:0}}
`;

export function renderEvidenceReport(input: EvidenceReportInput): string {
  const redact = input.redact ?? true;
  const { results, summary } = checkBatch(input.records);
  const hash = evidenceHash(input, summary);
  const now = new Date().toISOString().slice(0, 10);
  const violated = results.filter((r) => r.problems.length > 0);

  const rows = (r: TaskResult) =>
    r.problems
      .map((p) => {
        const ev = redact ? redactEvidence(p.kind, p.evidence) : p.evidence;
        const at = p.span ? ` <span class="mono">(chars ${p.span.start}–${p.span.end})</span>` : '';
        // For a fabricated atom the summary itself quotes the value, so redact
        // it to the shape when the report is redacted.
        const summary =
          redact && p.kind === 'ungrounded' && p.span
            ? `A ${p.span.atomKind} in the answer appears nowhere in the source material.`
            : p.summary;
        return `<div><span class="mono">${esc(p.kind)}</span>${at}<br>${esc(summary)}<br><span class="meta">${esc(ev)}</span></div>`;
      })
      .join('<hr style="border:0;border-top:1px dotted #ccc;margin:.5rem 0">');

  const contractBlock = input.contract ? renderContract(input.contract, redact) : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Evidence record — ${esc(input.batchLabel)}</title>
<style>${CSS}</style></head><body><main>

<h1>silentgreen evidence record</h1>
<p class="meta">
${input.clientName ? `Prepared for ${esc(input.clientName)}. ` : ''}
${input.preparedBy ? `Prepared by ${esc(input.preparedBy)}. ` : ''}
Issued ${now}.${input.periodLabel ? ` Covering ${esc(input.periodLabel)}.` : ''}<br>
Batch: <span class="mono">${esc(input.batchLabel)}</span>
</p>

<div class="lead">
<strong>What these checks can and cannot show.</strong><br>
${esc(summary.caveat)}
</div>

<h2>Result</h2>
<table>
<tr><th>Verdict</th><th>Count</th><th></th></tr>
<tr><td class="v-proven">proven</td><td>${summary.clean}</td><td class="meta">no detectable problem, checked against the material the model was given</td></tr>
<tr><td class="v-violated">violated</td><td>${summary.problematic}</td><td class="meta">a fact absent from the source, or a degenerate, deferred, contradictory or malformed answer</td></tr>
<tr><td class="v-unproven">unproven</td><td>${summary.inconclusive}</td><td class="meta">not enough captured to decide either way</td></tr>
<tr><td><strong>total</strong></td><td><strong>${summary.total}</strong></td><td></td></tr>
</table>

${summary.signals.length > 0 ? `<h2>Across the batch</h2>${summary.signals.map((s) => `<div class="signal"><strong>${esc(s.kind)}</strong> — ${esc(s.summary)}${s.sampleTaskIds.length ? `<br><span class="meta mono">e.g. ${esc(s.sampleTaskIds.join(', '))}</span>` : ''}</div>`).join('')}` : ''}

<h2>Findings (${violated.length})</h2>
${
    violated.length === 0
      ? '<p class="meta">No answer in this batch carried a problem these checks can detect. This is not a statement that the answers are correct.</p>'
      : violated
          .map((r) => `<div class="finding"><span class="id">${esc(r.id)}</span>${rows(r)}</div>`)
          .join('')
  }

${contractBlock}

<h2>Record-keeping</h2>
<p class="meta">
This document corresponds to a deterministic hash of the batch contents and the check
versions (<span class="mono">${CHECK_VERSION}</span>). Running the same batch through the
same version of silentgreen produces the same hash. A changed answer, source, or verdict
produces a different one.
</p>
<p class="hash">${hash}</p>
${redact ? '<p class="meta">Evidence in this record is redacted: the kind and shape of each finding is kept, never the personal value inside it. The full text is available from the local run.</p>' : '<p class="meta">This record contains full evidence, including values drawn from the source material. Handle accordingly.</p>'}

<div class="foot">
Generated by silentgreen. No language model was asked to grade another language model;
every verdict here is a deterministic comparison against text the model did not write.
</div>

</main></body></html>`;
}

/** Mask figures, dates, emails and links in a clause detail for a redacted report. */
function maskDetail(s: string): string {
  return s
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[address]')
    .replace(/\bhttps?:\/\/\S+/g, '[link]')
    .replace(/[£$€¥]\s?\d[\d,]*(?:\.\d+)?|\b\d{4}-\d{2}-\d{2}\b|\b\d[\d,]*\.\d+\b/g, '[value]');
}

function renderContract(cr: ContractReport, redact: boolean): string {
  const broken = cr.tasks.filter((t) => t.verdict === 'violated');
  const detail = (d: string) => (redact ? maskDetail(d) : d);
  return `
<h2>Against the contract: ${esc(cr.contract.pipeline)}</h2>
${cr.stale ? `<div class="stale">${esc(cr.staleReason)}</div>` : ''}
<p class="meta">Basis: ${esc(cr.contract.basis)}. Attestation: ${esc(cr.contract.attests)}</p>
<table>
<tr><th>Verdict</th><th>Tasks</th></tr>
<tr><td class="v-proven">proven</td><td>${cr.summary.proven}</td></tr>
<tr><td class="v-violated">violated</td><td>${cr.summary.violated}</td></tr>
<tr><td class="v-unproven">unproven</td><td>${cr.summary.unproven}</td></tr>
</table>
${
    broken.length === 0
      ? ''
      : broken
          .slice(0, 50)
          .map(
            (t) =>
              `<div class="finding"><span class="id">${esc(t.id)}</span>${t.clauses
                .filter((c) => c.verdict === 'violated')
                .map((c) => `<div>${esc(c.clause)}: ${esc(detail(c.detail))}${c.evidence && !redact ? `<br><span class="meta">${esc(c.evidence)}</span>` : ''}</div>`)
                .join('')}</div>`,
          )
          .join('')
  }`;
}
