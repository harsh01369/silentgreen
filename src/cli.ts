/**
 * Command line entry point.
 *
 *   silentgreen demo      the worked example, printed. No credentials.
 *   silentgreen seed      load that example into a local store, so review has something to show
 *   silentgreen scan      read an n8n instance, record it, propose expectations
 *   silentgreen review    open the review interface to confirm or refuse them
 *   silentgreen verify    check recent runs against confirmed expectations
 *   silentgreen watch     keep checking on a timer, and alert when something changes
 *   silentgreen report    produce the client evidence record
 *   silentgreen status    what is in the store, in one screen
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { audit, type AuditResult } from './audit';
import { demoWorkflow, demoTimeline, platformSummary, DEMO_WORKFLOW_ID } from './demo/scenario';
import { findSinks } from './contract/sinks';
import { proposeFromStructure, proposeFromObservation, type Proposal } from './contract/infer';
import { confirmAssertion } from './contract/circularity';
import { workflowHash, diffWorkflows } from './graph/hash';
import { inferCadence } from './verify/cadence';
import { Ledger } from './ledger/chain';
import { N8nClient, N8nError } from './connect/n8n';
import { renderReport } from './report/render';
import { Store, STORE_DIR } from './store/store';
import { serve } from './serve/server';
import type { Assertion, AssertionResult, Run } from './contract/types';
import { decideAlerts, worstPerAssertion } from './alert/state';
import { channelsFromEnv, send, renderText, type Channel, type MessageContext } from './alert/notify';
import { parseTaskRecords, type TaskRecord } from './aiwork/record';
import { checkBatch } from './aiwork/check';
import { demoTasks } from './aiwork/demo';
import { builtinBatches } from './eval/corpus';
import { scoreBatch, gate, DEFAULT_GATE } from './eval/score';

try {
  process.loadEnvFile('.env');
} catch {
  // Absent .env is fine. The demo needs no credentials at all.
}

const ESC = String.fromCharCode(27);
const C = {
  reset: ESC + '[0m',
  dim: ESC + '[2m',
  bold: ESC + '[1m',
  red: ESC + '[31m',
  green: ESC + '[32m',
  yellow: ESC + '[33m',
  blue: ESC + '[36m',
};

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
function c(code: string, s: string): string {
  return useColour ? `${code}${s}${C.reset}` : s;
}

function rule(label = ''): void {
  const width = 74;
  if (!label) {
    console.log(c(C.dim, '-'.repeat(width)));
    return;
  }
  console.log(`\n${c(C.bold, label)}\n${c(C.dim, '-'.repeat(width))}`);
}

function arg(rest: readonly string[], flag: string): string | undefined {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : undefined;
}

/* ------------------------------------------------------------------ demo -- */

async function runDemo(): Promise<void> {
  const healthyDoc = demoWorkflow(false);
  const editedDoc = demoWorkflow(true);
  const hash = workflowHash(healthyDoc);
  const timeline = demoTimeline();
  const platform = platformSummary(timeline);

  console.log(`
${c(C.bold, 'silentgreen')} ${c(C.dim, 'worked example')}

A Shopify order sync writing to Postgres and emailing customers. Hourly on
weekdays, six weeks of history. On day 22 the upstream API renamed a field.
`);

  rule('What the platform tells you');
  console.log(`  ${c(C.green, platform.sentence)}`);
  console.log(c(C.dim, '  Nothing here is wrong. It is simply not an answer to the question'));
  console.log(c(C.dim, '  "did the work happen", and it is the only answer most teams have.'));

  const healthyWindowEnd = new Date(Date.parse(timeline.startedAt) + timeline.breakageDay * 86_400_000);
  const healthyRuns = timeline.runs.filter((r) => Date.parse(r.startedAt) < healthyWindowEnd.getTime());
  const sinks = findSinks(healthyDoc);

  rule('Where work leaves this workflow');
  for (const s of sinks) {
    console.log(`  ${c(C.bold, s.nodeName)} ${c(C.dim, `(${s.category}, importance ${s.importance})`)}`);
    console.log(c(C.dim, `    ${s.rationale}`));
  }

  const proposals: Proposal[] = [
    ...proposeFromStructure(DEMO_WORKFLOW_ID, hash, sinks),
    ...proposeFromObservation(DEMO_WORKFLOW_ID, sinks, healthyRuns),
  ];

  rule(`Proposed expectations (${proposals.length})`);
  const byBasis = { intent: 0, structure: 0, observation: 0 };
  for (const p of proposals) byBasis[p.assertion.basis] += 1;
  console.log(
    `  ${byBasis.structure} from the graph's own definition, ${byBasis.observation} learned from ${healthyRuns.length} runs in the healthy window.`,
  );
  console.log(c(C.dim, '  None of them can raise anything yet. A proposal is not a check.'));

  const { confirmed, refusedCount } = confirmAllForDemo(proposals, hash, timeline, healthyRuns, healthyWindowEnd);

  rule('What a shrug gets you');
  const shrug = confirmAssertion(
    proposals.find((p) => p.assertion.basis === 'observation')!.assertion,
    {
      by: 'ops@agency.example',
      at: healthyWindowEnd.toISOString(),
      workflowHash: hash,
      evidenceRunIds: ['exec_0_9'],
      baselineAttestation: { windowStart: timeline.startedAt, windowEnd: healthyWindowEnd.toISOString(), howKnown: 'looks fine' },
    },
    { currentWorkflowHash: hash },
  );
  if ('refused' in shrug) console.log(`  ${c(C.yellow, 'refused')}  ${shrug.refused.message}`);
  console.log(`\n  ${confirmed.length} confirmed, ${refusedCount} refused at the gate.`);

  const profile = inferCadence(healthyRuns);

  rule('Verifying six weeks of runs against those expectations');
  const result = audit({
    workflowId: DEMO_WORKFLOW_ID,
    workflowName: healthyDoc.name ?? '',
    currentHash: hash,
    runs: timeline.runs,
    assertions: confirmed,
    now: new Date(timeline.now),
    cadenceShape: { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours },
  });

  console.log(`  ${c(C.bold, result.headline)}\n`);
  console.log(`  proven    ${c(C.green, String(result.counts.proven))}`);
  console.log(`  violated  ${c(C.red, String(result.counts.violated))}`);
  console.log(`  unproven  ${c(C.yellow, String(result.counts.unproven))}`);

  printFindings(result);

  rule('The check that would have rotted');
  for (const ch of diffWorkflows(healthyDoc, editedDoc)) console.log(`  ${ch.description}`);
  const editedHash = workflowHash(editedDoc);
  const afterEdit = audit({
    workflowId: DEMO_WORKFLOW_ID,
    workflowName: healthyDoc.name ?? '',
    currentHash: editedHash,
    runs: timeline.runs,
    assertions: confirmed,
    now: new Date(timeline.now),
    cadenceShape: { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours },
    previousDoc: healthyDoc,
    currentDoc: editedDoc,
  });
  console.log('\n  The same expectations against the same runs, one revision later:');
  console.log(`    proven    ${c(C.green, String(afterEdit.counts.proven))}  ${c(C.dim, `(was ${result.counts.proven})`)}`);
  console.log(`    violated  ${c(C.red, String(afterEdit.counts.violated))}  ${c(C.dim, `(was ${result.counts.violated})`)}`);
  console.log(`    unproven  ${c(C.yellow, String(afterEdit.counts.unproven))}  ${c(C.dim, `(was ${result.counts.unproven})`)}`);
  console.log(
    c(C.dim, '\n  Nothing turned green, and nothing kept accusing. The checks stopped claiming\n  to describe a graph they were never confirmed against, and said so out loud.'),
  );

  rule('Honesty about coverage');
  console.log(`  ${result.honesty.sentence}`);

  console.log(`
${c(C.dim, 'To use the review interface with this example loaded:')}
  silentgreen seed
  silentgreen review

${c(C.dim, 'Or against your own n8n:')}
  export N8N_URL=https://your-n8n.example  N8N_API_KEY=...
  silentgreen scan && silentgreen review
`);
}

function confirmAllForDemo(
  proposals: readonly Proposal[],
  hash: string,
  timeline: ReturnType<typeof demoTimeline>,
  healthyRuns: readonly Run[],
  healthyWindowEnd: Date,
): { confirmed: Assertion[]; refusedCount: number } {
  const confirmed: Assertion[] = [];
  let refusedCount = 0;
  for (const p of proposals) {
    const result = confirmAssertion(
      p.assertion,
      {
        by: 'ops@agency.example',
        at: healthyWindowEnd.toISOString(),
        workflowHash: hash,
        evidenceRunIds: healthyRuns.slice(0, 3).map((r) => r.id),
        ...(p.assertion.basis === 'observation'
          ? {
              baselineAttestation: {
                windowStart: timeline.startedAt,
                windowEnd: healthyWindowEnd.toISOString(),
                howKnown: 'Reconciled row counts and a sample of email addresses against the Shopify admin export for that period',
              },
            }
          : {}),
      },
      { currentWorkflowHash: hash },
    );
    if ('assertion' in result) confirmed.push(result.assertion);
    else refusedCount += 1;
  }
  return { confirmed, refusedCount };
}

function printFindings(result: AuditResult): void {
  const grouped = new Map<string, { statement: string; count: number; firstAt?: string; detail?: string; evidence?: string }>();
  for (const v of result.violations) {
    const g = grouped.get(v.result.assertionId);
    if (g) g.count += 1;
    else
      grouped.set(v.result.assertionId, {
        statement: v.result.statement,
        count: 1,
        firstAt: v.at,
        detail: v.result.detail,
        evidence: v.result.evidence,
      });
  }
  if (grouped.size === 0) return;
  rule(`What was caught (${grouped.size} distinct problems)`);
  for (const g of [...grouped.values()].sort((a, b) => b.count - a.count)) {
    console.log(`  ${c(C.red, 'x')} ${c(C.bold, g.statement)}`);
    console.log(
      g.firstAt
        ? `    ${g.count} run(s), first at ${new Date(g.firstAt).toISOString().slice(0, 16).replace('T', ' ')}`
        : '    detected against the workflow as a whole rather than any single run',
    );
    if (g.detail) console.log(c(C.dim, `    ${g.detail}`));
    if (g.evidence) console.log(`    ${c(C.blue, 'captured:')} ${g.evidence.slice(0, 150)}`);
    console.log('');
  }
}

/* ----------------------------------------------------------------- check -- */

async function runCheck(path: string | undefined, rest: readonly string[]): Promise<void> {
  let records: readonly TaskRecord[];
  let issues: readonly { line: number; reason: string }[] = [];

  if (!path || path === '--demo') {
    records = demoTasks();
    console.log(`
${c(C.bold, 'silentgreen check')} ${c(C.dim, 'worked example')}

Twenty answers from a support agent with the invoice in front of it. Every one
was recorded as a completed task, and every one reads as helpful.
`);
  } else {
    const text = readFileSync(path, 'utf8');
    const parsed = parseTaskRecords(text);
    records = parsed.records;
    issues = parsed.issues;
    console.log(`\n${records.length} task(s) read from ${path}.`);
    if (issues.length > 0) {
      console.log(c(C.yellow, `${issues.length} line(s) could not be read, and are not included in any count below:`));
      for (const i of issues.slice(0, 5)) console.log(c(C.dim, `  line ${i.line}: ${i.reason}`));
    }
    if (records.length === 0) {
      console.error(`
Nothing to check. Each line should be a JSON object with an answer in it, for example:

  {"id":"t1","input":"...","sources":["..."],"output":"..."}

Field names are flexible: output/response/answer/completion, sources/context/documents.
`);
      process.exitCode = 1;
      return;
    }
  }

  const { results, summary } = checkBatch(records, {
    skipGrounding: rest.includes('--no-grounding'),
  });

  rule('What was found');
  console.log(`  ${c(C.bold, summary.headline)}\n`);
  console.log(`  clean         ${c(C.green, String(summary.clean))}`);
  console.log(`  problems      ${c(C.red, String(summary.problematic))}`);
  console.log(`  inconclusive  ${c(C.yellow, String(summary.inconclusive))}`);

  const kinds: [keyof typeof summary.byKind, string][] = [
    ['ungrounded', 'facts absent from the source material'],
    ['degenerate', 'empty, unrendered or refused'],
    ['deferred', 'handed the task back instead of doing it'],
    ['duplicated', 'the same answer across different tasks'],
  ];
  console.log('');
  for (const [k, label] of kinds) {
    if (summary.byKind[k] > 0) console.log(`  ${String(summary.byKind[k]).padStart(3)}  ${label}`);
  }

  const bad = results.filter((r) => r.problems.length > 0);
  if (bad.length > 0) {
    rule(`The answers that would have shipped (${bad.length})`);
    for (const r of bad.slice(0, 12)) {
      console.log(`  ${c(C.red, 'x')} ${c(C.bold, r.id)}`);
      for (const p of r.problems.slice(0, 4)) {
        console.log(`    ${p.summary}`);
      }
      const first = r.problems[0];
      if (first) console.log(`    ${c(C.blue, 'captured:')} ${first.evidence.replace(/\s+/g, ' ').slice(0, 140)}`);
      console.log('');
    }
    if (bad.length > 12) console.log(c(C.dim, `  ...and ${bad.length - 12} more.\n`));
  }

  rule('What this did not check');
  console.log(`  ${summary.caveat}`);

  if (!path || path === '--demo') {
    console.log(`
${c(C.dim, 'Run it on your own:')}
  silentgreen check tasks.jsonl

${c(C.dim, 'One JSON object per line. Field names are flexible:')}
  {"id":"t1","input":"...","sources":["..."],"output":"..."}
`);
  }

  if (summary.problematic > 0) process.exitCode = 1;
}

/* ------------------------------------------------------------------ eval -- */

function runEval(rest: readonly string[]): void {
  const verbose = rest.includes('--verbose') || rest.includes('-v');
  const boards = builtinBatches().map(scoreBatch);

  console.log(`
${c(C.bold, 'silentgreen eval')} ${c(C.dim, 'checks scored against the labelled corpus')}

Every batch below is synthetic: written to pin down intended behaviour, not
drawn from real traffic. The numbers say the engine does what its author meant,
and nothing stronger, until real batches replace these.
`);

  rule('Per batch');
  const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
  console.log(c(C.dim, `  ${pad('batch', 26)} ${pad('P', 6)} ${pad('R', 6)} ${pad('FP', 4)} ${pad('FN', 4)} atoms P/R    gaps`));
  for (const b of boards) {
    const fpTxt = b.falsePositives > 0 ? c(C.red, pad(String(b.falsePositives), 4)) : pad(String(b.falsePositives), 4);
    console.log(
      `  ${pad(b.batch, 26)} ${pad(b.precision.toFixed(2), 6)} ${pad(b.recall.toFixed(2), 6)} ${fpTxt} ${pad(
        String(b.falseNegatives),
        4,
      )} ${pad(`${b.atomPrecision.toFixed(2)}/${b.atomRecall.toFixed(2)}`, 12)} ${b.knownGaps || ''}`,
    );
  }

  const disagreements = boards.flatMap((b) => b.disagreements.map((d) => ({ batch: b.batch, ...d })));
  const hard = disagreements.filter((d) => !d.knownGap);
  const gaps = disagreements.filter((d) => d.knownGap);

  if (hard.length > 0 || verbose) {
    rule(`Disagreements (${hard.length})`);
    for (const d of hard) {
      console.log(`  ${c(C.red, 'x')} ${c(C.bold, d.id)} ${c(C.dim, `[${d.batch}]`)}`);
      console.log(`    expected ${d.expected}, got ${d.got}: ${d.detail}`);
    }
    if (hard.length === 0) console.log(c(C.green, '  none'));
  }

  if (gaps.length > 0) {
    rule(`Documented gaps (${gaps.length})`);
    for (const d of gaps) console.log(`  ${c(C.yellow, '-')} ${d.id} ${c(C.dim, `[${d.batch}]`)}: ${d.knownGap}`);
  }

  const g = gate(boards, DEFAULT_GATE);
  rule('Gate');
  const totFp = boards.reduce((s, b) => s + b.falsePositives, 0);
  const totTp = boards.reduce((s, b) => s + b.truePositives, 0);
  const totFn = boards.reduce((s, b) => s + b.falseNegatives, 0);
  console.log(
    `  overall precision ${(totTp / Math.max(1, totTp + totFp)).toFixed(3)}, recall ${(totTp / Math.max(1, totTp + totFn)).toFixed(
      3,
    )}, ${totFp} false positive(s) on faithful answers`,
  );
  console.log(
    `  thresholds: precision >= ${DEFAULT_GATE.minPrecision}, recall >= ${DEFAULT_GATE.minRecall}, false positives <= ${DEFAULT_GATE.maxFalsePositives}`,
  );
  if (g.ok) {
    console.log(`\n  ${c(C.green, 'PASS')}\n`);
  } else {
    console.log(`\n  ${c(C.red, 'FAIL')}`);
    for (const f of g.failures) console.log(`    ${f}`);
    console.log('');
    process.exitCode = 1;
  }
}

/* ------------------------------------------------------------------ seed -- */

function runSeed(storeDir: string): void {
  const doc = demoWorkflow(false);
  const hash = workflowHash(doc);
  const timeline = demoTimeline();
  const healthyEnd = Date.parse(timeline.startedAt) + timeline.breakageDay * 86_400_000;
  const healthyRuns = timeline.runs.filter((r) => Date.parse(r.startedAt) < healthyEnd);
  const sinks = findSinks(doc);
  const profile = inferCadence(healthyRuns);

  const store = new Store(storeDir);
  store.observeWorkflow({
    id: DEMO_WORKFLOW_ID,
    platform: 'n8n',
    name: doc.name ?? 'Worked example',
    active: true,
    hash,
    doc,
    runs: healthyRuns,
    cadenceShape: { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours },
  });
  store.setClient(DEMO_WORKFLOW_ID, 'worked-example', 'Fernweh Supply (worked example)');

  const proposals = [
    ...proposeFromStructure(DEMO_WORKFLOW_ID, hash, sinks),
    ...proposeFromObservation(DEMO_WORKFLOW_ID, sinks, healthyRuns),
  ];
  const { added, skipped } = store.addProposals(proposals);
  store.save();

  console.log(`
Loaded the worked example into ${storeDir}/

  1 workflow, ${added} expectations waiting for review${skipped ? ` (${skipped} already present)` : ''}.

Nothing is live yet, and nothing can raise anything until you confirm it. That is
the point of the next step:

  silentgreen review

Everything here is fabricated data held on your own disk. Delete ${storeDir}/ to remove it.
`);
}

/* ------------------------------------------------------------------ scan -- */

async function runScan(storeDir: string): Promise<void> {
  const baseUrl = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error(`Set N8N_URL and N8N_API_KEY first, in the environment or a .env file:

  N8N_URL=https://your-n8n.example
  N8N_API_KEY=n8n_api_...

Create the key under Settings, n8n API. Read access is all this needs and all it
ever uses: there is no code path in this tool that writes to your instance.

To try the review interface with no instance at all:  silentgreen seed`);
    process.exitCode = 1;
    return;
  }

  const client = new N8nClient({ baseUrl, apiKey });
  const store = new Store(storeDir);
  const workflows = await client.listWorkflows();
  console.log(`\n${workflows.length} workflow(s) visible to this key.\n`);

  let totalAdded = 0;
  for (const wf of workflows) {
    const doc = await client.getWorkflow(wf.id);
    const sinks = findSinks(doc);
    const runs = await client.listRuns(wf.id, { limit: 50, includeData: true });
    const profile = inferCadence(runs);

    const { changes, staled } = store.observeWorkflow({
      id: wf.id,
      platform: 'n8n',
      name: wf.name,
      active: wf.active,
      hash: wf.hash,
      doc,
      runs,
      cadenceShape: { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours },
    });

    const proposals = [
      ...proposeFromStructure(wf.id, wf.hash, sinks),
      ...proposeFromObservation(wf.id, sinks, runs),
    ];
    const { added, skipped } = store.addProposals(proposals);
    totalAdded += added;

    console.log(`${c(C.bold, wf.name)} ${c(C.dim, `(${wf.active ? 'active' : 'inactive'}, revision ${wf.hash.slice(0, 10)})`)}`);
    console.log(c(C.dim, `  ${runs.length} recent run(s), ${sinks.length} sink(s), ${added} new expectation(s)${skipped ? `, ${skipped} already on file` : ''}`));
    if (runs.length === 0) {
      console.log(c(C.yellow, '  No executions retained, so nothing can be proposed from observation yet.'));
    }
    if (changes.length > 0) {
      console.log(c(C.yellow, `  This workflow changed since the last scan. ${staled} confirmed check(s) went stale:`));
      for (const ch of changes.slice(0, 6)) console.log(c(C.dim, `    ${ch.description}`));
    }
    console.log('');
  }

  store.save();
  console.log(`${totalAdded} expectation(s) waiting for review. Nothing is live until confirmed:\n\n  silentgreen review\n`);
}

/* ---------------------------------------------------------------- verify -- */

interface CycleOutcome {
  readonly anyViolation: boolean;
  readonly results: AssertionResult[];
  readonly context: Map<string, MessageContext>;
}

async function runVerify(storeDir: string, opts: { notify?: boolean; quiet?: boolean } = {}): Promise<void> {
  const store = new Store(storeDir);
  const workflows = store.workflows();
  if (workflows.length === 0) {
    console.error(`Nothing in ${storeDir}/ yet. Run "silentgreen scan", or "silentgreen seed" to try it with the worked example.`);
    process.exitCode = 1;
    return;
  }

  const outcome = await verifyCycle(store, { quiet: opts.quiet });

  if (opts.notify) {
    await dispatchAlerts(store, outcome, channelsFromEnv());
  }

  store.save();
  if (!opts.quiet) {
    console.log(c(C.dim, `Recorded in ${storeDir}/ledger.jsonl. Exit code is 1 when anything was violated, so this fits a cron job.`));
  }
  if (outcome.anyViolation) process.exitCode = 1;
}

/**
 * One pass over everything in the store.
 *
 * Shared by `verify` (one shot, for cron) and `watch` (a loop, for a box that
 * stays up), so the two can never drift into disagreeing about what counts as a
 * violation.
 */
async function verifyCycle(store: Store, opts: { quiet?: boolean } = {}): Promise<CycleOutcome> {
  const workflows = store.workflows();
  const baseUrl = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  const client = baseUrl && apiKey ? new N8nClient({ baseUrl, apiKey }) : undefined;

  let anyViolation = false;
  const allResults: AssertionResult[] = [];
  const context = new Map<string, MessageContext>();

  for (const wf of workflows) {
    const confirmed = store.assertions(wf.id).filter((a) => a.status === 'confirmed');
    const isWorkedExample = wf.id === DEMO_WORKFLOW_ID;

    let runs: readonly Run[];
    let now = new Date();
    if (isWorkedExample) {
      const t = demoTimeline();
      runs = t.runs;
      now = new Date(t.now);
    } else if (client) {
      runs = await client.listRuns(wf.id, { limit: 50, includeData: true });
    } else {
      if (!opts.quiet) {
        console.log(`${c(C.bold, wf.name)}`);
        console.log(c(C.yellow, '  Skipped: no N8N_URL and N8N_API_KEY, so recent runs could not be fetched.'));
      }
      continue;
    }

    const result = audit({
      workflowId: wf.id,
      workflowName: wf.name,
      currentHash: wf.hash,
      runs,
      assertions: confirmed,
      now,
      cadenceShape: wf.cadenceShape,
    });

    const clientName = wf.clientId ? (store.clients()[wf.clientId]?.name ?? wf.clientId) : undefined;
    for (const r of result.perRun.flatMap((p) => p.results)) {
      allResults.push(r);
      context.set(r.assertionId, { workflowName: wf.name, clientName });
    }
    if (result.cadence) {
      allResults.push(result.cadence);
      context.set(result.cadence.assertionId, { workflowName: wf.name, clientName });
    }

    if (!opts.quiet) {
      console.log(`${c(C.bold, wf.name)}${isWorkedExample ? c(C.dim, '  (worked example, fabricated data)') : ''}`);
      console.log(`  ${result.headline}`);
      console.log(
        `  proven ${c(C.green, String(result.counts.proven))}  violated ${c(C.red, String(result.counts.violated))}  unproven ${c(C.yellow, String(result.counts.unproven))}`,
      );
    }

    for (const v of result.violations) {
      store.ledger.append(
        v.result.verdict === 'violated' && !v.runId ? 'absence-detected' : 'violation',
        wf.id,
        {
          assertionId: v.result.assertionId,
          statement: v.result.statement,
          runId: v.runId,
          detail: v.result.detail,
          evidence: v.result.evidence,
        },
        { clientId: wf.clientId },
      );
    }
    store.ledger.append(
      'run-verified',
      wf.id,
      { runsExamined: result.runsExamined, proven: result.counts.proven, violated: result.counts.violated, unproven: result.counts.unproven },
      { clientId: wf.clientId },
    );

    if (result.counts.violated > 0) anyViolation = true;
    if (!opts.quiet) printFindings(result);
  }

  return { anyViolation, results: allResults, context };
}

/**
 * Decide what is worth saying, say it, and record whether it was actually said.
 *
 * The last part matters more than it looks. A notifier that fails silently is
 * this product's own subject matter one level up, so a rotated webhook that now
 * returns 404 must not leave us reporting that somebody was told.
 */
async function dispatchAlerts(store: Store, outcome: CycleOutcome, channels: readonly Channel[]): Promise<void> {
  const perAssertion = worstPerAssertion(outcome.results);
  const { actions, state } = decideAlerts(perAssertion, store.alerts(), new Date());
  store.setAlerts(state);

  if (actions.length === 0) return;

  if (channels.length === 0) {
    console.log(
      c(C.yellow, `\n${actions.length} alert(s) would have been sent, but no channel is configured.`),
    );
    console.log(c(C.dim, '  Set SILENTGREEN_SLACK_WEBHOOK, SILENTGREEN_DISCORD_WEBHOOK, SILENTGREEN_TEAMS_WEBHOOK'));
    console.log(c(C.dim, '  or SILENTGREEN_WEBHOOK. Nothing is being delivered until you do, and this tool'));
    console.log(c(C.dim, '  will not pretend otherwise.'));
    for (const a of actions) {
      const ctx = outcome.context.get(a.assertionId) ?? { workflowName: 'unknown workflow' };
      console.log(`\n${renderText(a, ctx)}`);
    }
    return;
  }

  for (const action of actions) {
    const ctx = outcome.context.get(action.assertionId) ?? { workflowName: 'unknown workflow' };
    const delivery = await send(channels, action, ctx);
    const failed = delivery.filter((d) => !d.ok);

    store.ledger.append('note', 'alerting', {
      alert: action.kind,
      assertionId: action.assertionId,
      workflow: ctx.workflowName,
      delivered: delivery.filter((d) => d.ok).map((d) => d.channel),
      failed: failed.map((d) => ({ channel: d.channel, status: d.status, error: d.error })),
    });

    const label = action.kind === 'resolved' ? c(C.green, 'recovered') : c(C.red, action.kind);
    console.log(`  alert ${label}: ${ctx.workflowName}`);
    for (const f of failed) {
      console.log(
        c(C.red, `    delivery to ${f.channel} FAILED${f.status ? ` (HTTP ${f.status})` : ''}${f.error ? `: ${f.error}` : ''}`),
      );
    }
  }
}

/* ----------------------------------------------------------------- watch -- */

async function runWatch(storeDir: string, intervalSeconds: number): Promise<void> {
  const channels = channelsFromEnv();

  // Say what is actually being watched before claiming to watch anything. A
  // watcher that prints "0 violated" every cycle while nothing is confirmed is
  // reporting exactly the comfortable green this tool exists to catch, and it
  // would be reporting it about itself.
  const opening = new Store(storeDir);
  const live = opening.assertions().filter((a) => a.status === 'confirmed').length;
  const stale = opening.assertions().filter((a) => a.status === 'stale').length;
  const waiting = opening.assertions().filter((a) => a.status === 'proposed').length;

  console.log(`
${c(C.bold, 'silentgreen watch')}

Checking every ${intervalSeconds >= 60 ? `${Math.round(intervalSeconds / 60)} minutes` : `${intervalSeconds} seconds`}, reading ${storeDir}/.
${opening.workflows().length} workflow(s), ${live} live check(s)${stale ? `, ${stale} stale` : ''}${waiting ? `, ${waiting} waiting for review` : ''}.
${
  channels.length > 0
    ? `Alerting to: ${channels.map((ch) => ch.kind).join(', ')}.`
    : c(C.yellow, 'No alert channel is configured, so nothing will be delivered. Alerts will be printed here instead.')
}
Press Ctrl+C to stop.
`);

  if (live === 0) {
    console.log(c(C.yellow, 'Nothing is confirmed, so this will watch and find nothing, every cycle, forever.'));
    console.log(c(C.yellow, `Confirm something first: silentgreen review${waiting ? ` (${waiting} waiting)` : ''}`));
    console.log('');
  }

  let cycle = 0;
  for (;;) {
    cycle += 1;
    const startedAt = new Date();
    try {
      const store = new Store(storeDir);
      const outcome = await verifyCycle(store, { quiet: true });
      await dispatchAlerts(store, outcome, channels);
      store.save();

      const worst = worstPerAssertion(outcome.results);
      const violated = worst.filter((r) => r.verdict === 'violated').length;
      const unproven = worst.filter((r) => r.verdict === 'unproven').length;
      const proven = worst.filter((r) => r.verdict === 'proven').length;
      console.log(
        `${startedAt.toISOString().slice(11, 19)}  cycle ${cycle}: ${c(C.green, String(proven))} proven, ${c(C.red, String(violated))} violated, ${c(C.yellow, String(unproven))} unproven`,
      );
    } catch (err) {
      // A failing cycle must not kill the watcher, or the thing that watches for
      // silence becomes silent itself.
      console.error(c(C.red, `${startedAt.toISOString().slice(11, 19)}  cycle ${cycle} failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
}

/* ---------------------------------------------------------------- report -- */

async function runReport(storeDir: string, outPath: string, clientFilter?: string): Promise<void> {
  const store = new Store(storeDir);
  const workflows = store.workflows().filter((w) => !clientFilter || w.clientId === clientFilter);
  if (workflows.length === 0) {
    console.error(`No workflows in ${storeDir}/${clientFilter ? ` for client "${clientFilter}"` : ''}. Run "silentgreen seed" or "silentgreen scan" first.`);
    process.exitCode = 1;
    return;
  }

  const wf = workflows[0]!;
  const confirmed = store.assertions(wf.id).filter((a) => a.status === 'confirmed');
  const isWorkedExample = wf.id === DEMO_WORKFLOW_ID;

  const baseUrl = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  let runs: readonly Run[] = [];
  let now = new Date();
  let periodStart = new Date(Date.now() - 30 * 86_400_000).toISOString();

  if (isWorkedExample) {
    const t = demoTimeline();
    runs = t.runs;
    now = new Date(t.now);
    periodStart = t.startedAt;
  } else if (baseUrl && apiKey) {
    runs = await new N8nClient({ baseUrl, apiKey }).listRuns(wf.id, { limit: 200, includeData: true });
    if (runs.length > 0) periodStart = runs[runs.length - 1]!.startedAt;
  }

  const result = audit({
    workflowId: wf.id,
    workflowName: wf.name,
    currentHash: wf.hash,
    runs,
    assertions: confirmed,
    now,
    cadenceShape: wf.cadenceShape,
    previousDoc: wf.previousDoc,
    currentDoc: wf.doc,
  });

  const platform = {
    executions: runs.length,
    succeeded: runs.filter((r) => r.platformStatus === 'success').length,
    failed: runs.filter((r) => r.platformStatus === 'error').length,
    sentence: `${runs.length} executions, ${runs.filter((r) => r.platformStatus === 'success').length} successful, ${runs.filter((r) => r.platformStatus === 'error').length} failed.`,
  };

  const html = renderReport({
    result,
    assertions: confirmed,
    ledger: store.ledger,
    periodStart,
    periodEnd: now.toISOString(),
    clientName: wf.clientId ? (store.clients()[wf.clientId]?.name ?? wf.clientId) : wf.name,
    preparedBy: confirmed[0]?.confirmation?.by ?? 'silentgreen',
    platform,
  });
  writeFileSync(outPath, html, 'utf8');
  console.log(`Report written to ${outPath}`);
  if (isWorkedExample) console.log(c(C.dim, 'This one is the worked example, so the figures are fabricated. Say so if you show it to anybody.'));
}

/* ---------------------------------------------------------------- status -- */

function runStatus(storeDir: string): void {
  const store = new Store(storeDir);
  const wfs = store.workflows();
  const chain = store.ledger.verify();

  console.log(`\n${c(C.bold, 'silentgreen')} ${c(C.dim, storeDir + '/')}`);
  console.log(c(C.dim, `${store.ledger.length} ledger entries, chain ${chain.ok ? 'intact' : 'BROKEN'}\n`));

  if (wfs.length === 0) {
    console.log('Nothing scanned yet. Try "silentgreen seed" or "silentgreen scan".\n');
    return;
  }

  for (const wf of wfs) {
    const n = store.counts(wf.id);
    console.log(`${c(C.bold, wf.name)} ${c(C.dim, `(${wf.hash.slice(0, 10)}, scanned ${wf.lastScannedAt.slice(0, 10)})`)}`);
    console.log(
      `  ${n.proposed} to review, ${c(C.green, String(n.confirmed))} live${n.stale ? `, ${c(C.yellow, String(n.stale))} stale` : ''}${n.retired ? `, ${n.retired} retired` : ''}`,
    );
    const honesty = store.assertions(wf.id);
    const live = honesty.filter((a) => a.status === 'confirmed');
    if (live.length === 0) {
      console.log(c(C.yellow, '  Nothing is being verified. Any green elsewhere means code ran, not that work happened.'));
    }
    console.log('');
  }
}

/* ------------------------------------------------------------------ main -- */

async function main(): Promise<void> {
  const [command = 'demo', ...rest] = process.argv.slice(2);
  const storeDir = arg(rest, '--store') ?? STORE_DIR;

  switch (command) {
    case 'check':
      return runCheck(rest.find((r) => !r.startsWith('--')), rest);
    case 'eval':
      return runEval(rest);
    case 'demo':
      return runDemo();
    case 'seed':
      return runSeed(storeDir);
    case 'scan':
      return runScan(storeDir);
    case 'verify':
      return runVerify(storeDir, { notify: rest.includes('--notify') });
    case 'watch':
      return runWatch(storeDir, Number(arg(rest, '--interval') ?? 300));
    case 'status':
      return runStatus(storeDir);
    case 'review': {
      const port = Number(arg(rest, '--port') ?? 4666);
      const { url } = await serve({ port, storeDir });
      console.log(`
${c(C.bold, 'Review interface')}  ${url}

Reading ${storeDir}/. Confirm or refuse the expectations waiting there.
Nothing can raise an alert until you do. Press Ctrl+C to stop.
`);
      return new Promise(() => {
        /* hold the process open until interrupted */
      });
    }
    case 'report':
      return runReport(storeDir, arg(rest, '--out') ?? 'silentgreen-report.html', arg(rest, '--client'));
    case 'help':
    case '--help':
    case '-h':
      console.log(`silentgreen

  check [file.jsonl]       verify a batch of AI work. No credentials, no setup.
  eval [--verbose]         score the checks against the labelled corpus
  demo                     the n8n worked example, printed
  seed                     load that example into a local store
  scan                     read an n8n instance and propose expectations
  review [--port 4666]     open the review interface to confirm them
  verify [--notify]        check recent runs against confirmed expectations
  watch [--interval 300]   keep checking, and alert when something changes
  report [--out f.html]    produce the client evidence record
  status                   what is in the store

  --store DIR              where to keep state (default ${STORE_DIR}/)
  N8N_URL, N8N_API_KEY     read-only credentials for scan and verify

  Alert channels, all optional, all plain webhooks:
    SILENTGREEN_SLACK_WEBHOOK
    SILENTGREEN_DISCORD_WEBHOOK
    SILENTGREEN_TEAMS_WEBHOOK
    SILENTGREEN_WEBHOOK      generic JSON POST
`);
      return;
    default:
      console.error(`Unknown command "${command}". Try: silentgreen help`);
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  if (err instanceof N8nError) {
    console.error(`\n${err.message}`);
    if (err.hint) console.error(err.hint);
    process.exit(1);
  }
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
