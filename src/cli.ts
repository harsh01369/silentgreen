/**
 * Command line entry point.
 *
 *   silentgreen demo      the worked example, printed. No credentials.
 *   silentgreen seed      load that example into a local store, so review has something to show
 *   silentgreen scan      read an n8n instance, record it, propose expectations
 *   silentgreen review    open the review interface to confirm or refuse them
 *   silentgreen verify    check recent runs against confirmed expectations
 *   silentgreen report    produce the client evidence record
 *   silentgreen status    what is in the store, in one screen
 */

import { writeFileSync } from 'node:fs';
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
import type { Assertion, Run } from './contract/types';

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

async function runVerify(storeDir: string): Promise<void> {
  const store = new Store(storeDir);
  const workflows = store.workflows();
  if (workflows.length === 0) {
    console.error(`Nothing in ${storeDir}/ yet. Run "silentgreen scan", or "silentgreen seed" to try it with the worked example.`);
    process.exitCode = 1;
    return;
  }

  const baseUrl = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  const client = baseUrl && apiKey ? new N8nClient({ baseUrl, apiKey }) : undefined;

  let anyViolation = false;

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
      console.log(`${c(C.bold, wf.name)}`);
      console.log(c(C.yellow, '  Skipped: no N8N_URL and N8N_API_KEY, so recent runs could not be fetched.'));
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

    console.log(`${c(C.bold, wf.name)}${isWorkedExample ? c(C.dim, '  (worked example, fabricated data)') : ''}`);
    console.log(`  ${result.headline}`);
    console.log(
      `  proven ${c(C.green, String(result.counts.proven))}  violated ${c(C.red, String(result.counts.violated))}  unproven ${c(C.yellow, String(result.counts.unproven))}`,
    );

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
    printFindings(result);
  }

  store.save();
  console.log(c(C.dim, `Recorded in ${storeDir}/ledger.jsonl. Exit code is 1 when anything was violated, so this fits a cron job.`));
  if (anyViolation) process.exitCode = 1;
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
    case 'demo':
      return runDemo();
    case 'seed':
      return runSeed(storeDir);
    case 'scan':
      return runScan(storeDir);
    case 'verify':
      return runVerify(storeDir);
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

  demo                     the worked example, printed. No credentials needed.
  seed                     load that example into a local store
  scan                     read an n8n instance and propose expectations
  review [--port 4666]     open the review interface to confirm them
  verify                   check recent runs against confirmed expectations
  report [--out f.html]    produce the client evidence record
  status                   what is in the store

  --store DIR              where to keep state (default ${STORE_DIR}/)
  N8N_URL, N8N_API_KEY     read-only credentials for scan and verify
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
