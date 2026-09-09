/**
 * Command line entry point.
 *
 *   silentgreen demo                     run the worked example, no account needed
 *   silentgreen scan                     read an n8n instance and propose contracts
 *   silentgreen verify                   check recent runs against confirmed contracts
 *   silentgreen report --out report.html produce the client evidence report
 */

import { writeFileSync } from 'node:fs';
import { audit } from './audit';
import { demoWorkflow, demoTimeline, platformSummary, DEMO_WORKFLOW_ID } from './demo/scenario';
import { findSinks } from './contract/sinks';
import { proposeFromStructure, proposeFromObservation, type Proposal } from './contract/infer';
import { confirmAssertion } from './contract/circularity';
import { workflowHash, diffWorkflows } from './graph/hash';
import { inferCadence } from './verify/cadence';
import { Ledger } from './ledger/chain';
import { N8nClient, N8nError } from './connect/n8n';
import { renderReport } from './report/render';
import type { Assertion } from './contract/types';

try {
  process.loadEnvFile('.env');
} catch {
  // Absent .env is fine. The demo needs no credentials at all.
}

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
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

  // Contracts are learned from the healthy window only, which is the whole
  // point of a baseline attestation: a human states which period was good.
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

  rule(`Proposed contracts (${proposals.length})`);
  const byBasis = { intent: 0, structure: 0, observation: 0 };
  for (const p of proposals) byBasis[p.assertion.basis] += 1;
  console.log(
    `  ${byBasis.structure} from the graph's own definition, ${byBasis.observation} learned from ${healthyRuns.length} runs in the healthy window.`,
  );
  console.log(c(C.dim, '  None of them can raise anything yet. A proposal is not a check.'));

  // A person confirms. Observation-basis proposals require the attestation, so
  // this is where the demo shows the gate doing its job.
  const ledger = new Ledger();
  ledger.append('workflow-observed', DEMO_WORKFLOW_ID, { name: healthyDoc.name, hash });

  const confirmed: Assertion[] = [];
  let refusedCount = 0;

  for (const p of proposals) {
    const needsAttestation = p.assertion.basis === 'observation';
    const result = confirmAssertion(
      p.assertion,
      {
        by: 'ops@agency.example',
        at: healthyWindowEnd.toISOString(),
        workflowHash: hash,
        evidenceRunIds: healthyRuns.slice(0, 3).map((r) => r.id),
        ...(needsAttestation
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
    if ('assertion' in result) {
      confirmed.push(result.assertion);
      ledger.append('assertion-confirmed', DEMO_WORKFLOW_ID, {
        assertionId: result.assertion.id,
        statement: result.assertion.statement,
        basis: result.assertion.basis,
        by: 'ops@agency.example',
      });
    } else {
      refusedCount += 1;
    }
  }

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
  if ('refused' in shrug) {
    console.log(`  ${c(C.yellow, 'refused')}  ${shrug.refused.message}`);
  }

  console.log(`\n  ${confirmed.length} confirmed, ${refusedCount} refused at the gate.`);

  const profile = inferCadence(healthyRuns);

  rule('Verifying six weeks of runs against those contracts');
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

  // Group violations so the output reads like an incident summary rather than a log.
  const grouped = new Map<string, { statement: string; count: number; firstAt?: string; detail?: string; evidence?: string }>();
  for (const v of result.violations) {
    const key = v.result.assertionId;
    const g = grouped.get(key);
    if (g) {
      g.count += 1;
    } else {
      grouped.set(key, {
        statement: v.result.statement,
        count: 1,
        firstAt: v.at,
        detail: v.result.detail,
        evidence: v.result.evidence,
      });
    }
  }

  rule(`What was caught (${grouped.size} distinct problems)`);
  for (const g of [...grouped.values()].sort((a, b) => b.count - a.count)) {
    console.log(`  ${c(C.red, '✗')} ${c(C.bold, g.statement)}`);
    console.log(
      g.firstAt
        ? `    ${g.count} run(s), first at ${new Date(g.firstAt).toISOString().slice(0, 16).replace('T', ' ')}`
        : '    detected against the workflow as a whole rather than any single run',
    );
    if (g.detail) console.log(c(C.dim, `    ${g.detail}`));
    if (g.evidence) console.log(`    ${c(C.blue, 'captured:')} ${g.evidence.slice(0, 150)}`);
    console.log('');
  }

  rule('The check that would have rotted');
  const changes = diffWorkflows(healthyDoc, editedDoc);
  for (const ch of changes) console.log(`  ${ch.description}`);

  // Show it rather than assert it: the same contracts against the same runs,
  // with the workflow now at a revision none of them were confirmed for.
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
  console.log('\n  The same contracts against the same runs, one revision later:');
  console.log(`    proven    ${c(C.green, String(afterEdit.counts.proven))}  ${c(C.dim, `(was ${result.counts.proven})`)}`);
  console.log(`    violated  ${c(C.red, String(afterEdit.counts.violated))}  ${c(C.dim, `(was ${result.counts.violated})`)}`);
  console.log(`    unproven  ${c(C.yellow, String(afterEdit.counts.unproven))}  ${c(C.dim, `(was ${result.counts.unproven})`)}`);
  console.log(
    c(C.dim, '\n  Nothing turned green, and nothing kept accusing. The checks stopped claiming\n  to describe a graph they were never confirmed against, and said so out loud.\n  That is the difference between a check that goes stale and one that rots.'),
  );

  rule('Honesty about coverage');
  console.log(`  ${result.honesty.sentence}`);
  console.log(
    c(C.dim, `\n  ${result.honesty.byBasis.intent} intent, ${result.honesty.byBasis.structure} structure, ${result.honesty.byBasis.observation} observation.`),
  );
  console.log(
    c(C.dim, '  No check here traces back to a stated business intent, because nobody has\n  yet said what this workflow is for. Until they do, this can prove the sync\n  has not changed. It cannot prove it was ever right.'),
  );

  const chain = ledger.verify();
  rule('Evidence ledger');
  console.log(`  ${ledger.length} entries, chain ${chain.ok ? c(C.green, 'intact') : c(C.red, 'broken')}.`);
  console.log(c(C.dim, '  Every confirmation records who took responsibility and what they were shown.'));

  console.log(`
${c(C.dim, 'Run it against your own n8n:')}
  export N8N_URL=https://your-n8n.example  N8N_API_KEY=...
  npx silentgreen scan
`);
}

async function runScan(): Promise<void> {
  const baseUrl = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error(`Set N8N_URL and N8N_API_KEY first, either in the environment or in a .env file:

  N8N_URL=https://your-n8n.example
  N8N_API_KEY=n8n_api_...

Create the key under Settings, n8n API. Read access is all this needs, and all
it ever uses: there is no code path in this tool that writes to your instance.

To see what it does without connecting anything, run:  npx silentgreen demo`);
    process.exitCode = 1;
    return;
  }

  const client = new N8nClient({ baseUrl, apiKey });
  const workflows = await client.listWorkflows();
  console.log(`\n${workflows.length} workflow(s) visible to this key.\n`);

  for (const wf of workflows) {
    const doc = await client.getWorkflow(wf.id);
    const sinks = findSinks(doc);
    const runs = await client.listRuns(wf.id, { limit: 50, includeData: true });
    const proposals = [
      ...proposeFromStructure(wf.id, wf.hash, sinks),
      ...proposeFromObservation(wf.id, sinks, runs),
    ];
    const cadence = inferCadence(runs);

    console.log(`${c(C.bold, wf.name)} ${c(C.dim, `(${wf.id}, ${wf.active ? 'active' : 'inactive'})`)}`);
    console.log(c(C.dim, `  revision ${wf.hash.slice(0, 12)}, ${runs.length} recent run(s), ${sinks.length} sink(s)`));
    if (runs.length === 0) {
      console.log(c(C.yellow, '  No executions retained, so nothing can be proposed from observation yet.'));
    }
    for (const p of proposals) {
      const tag = p.assertion.basis === 'observation' ? c(C.yellow, 'observation') : c(C.blue, p.assertion.basis);
      console.log(`  [${tag}] ${p.assertion.statement}`);
      console.log(c(C.dim, `      ${p.rationale}`));
    }
    if (cadence) console.log(c(C.dim, `  cadence: ${cadence.reasoning}`));
    console.log('');
  }

  console.log(c(C.dim, 'Nothing above is active yet. A proposal cannot raise an alert until a person'));
  console.log(c(C.dim, 'confirms it, and observation-basis proposals additionally require you to state'));
  console.log(c(C.dim, 'which period you believe was correct, and how you know.'));
}

async function runReport(outPath: string): Promise<void> {
  const doc = demoWorkflow(false);
  const hash = workflowHash(doc);
  const timeline = demoTimeline();
  const healthyEnd = Date.parse(timeline.startedAt) + timeline.breakageDay * 86_400_000;
  const healthyRuns = timeline.runs.filter((r) => Date.parse(r.startedAt) < healthyEnd);
  const sinks = findSinks(doc);
  const proposals = [
    ...proposeFromStructure(DEMO_WORKFLOW_ID, hash, sinks),
    ...proposeFromObservation(DEMO_WORKFLOW_ID, sinks, healthyRuns),
  ];
  const confirmed: Assertion[] = [];
  for (const p of proposals) {
    const r = confirmAssertion(
      p.assertion,
      {
        by: 'ops@agency.example',
        at: new Date(healthyEnd).toISOString(),
        workflowHash: hash,
        evidenceRunIds: healthyRuns.slice(0, 3).map((x) => x.id),
        ...(p.assertion.basis === 'observation'
          ? {
              baselineAttestation: {
                windowStart: timeline.startedAt,
                windowEnd: new Date(healthyEnd).toISOString(),
                howKnown: 'Reconciled row counts and a sample of email addresses against the Shopify admin export for that period',
              },
            }
          : {}),
      },
      { currentWorkflowHash: hash },
    );
    if ('assertion' in r) confirmed.push(r.assertion);
  }
  const profile = inferCadence(healthyRuns);
  const result = audit({
    workflowId: DEMO_WORKFLOW_ID,
    workflowName: doc.name ?? '',
    currentHash: hash,
    runs: timeline.runs,
    assertions: confirmed,
    now: new Date(timeline.now),
    cadenceShape: { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours },
  });

  const ledger = new Ledger();
  ledger.append('workflow-observed', DEMO_WORKFLOW_ID, { name: doc.name, hash });
  for (const a of confirmed) {
    ledger.append('assertion-confirmed', DEMO_WORKFLOW_ID, { assertionId: a.id, statement: a.statement, basis: a.basis, by: a.confirmation?.by });
  }
  for (const v of result.violations.slice(0, 50)) {
    ledger.append('violation', DEMO_WORKFLOW_ID, { assertionId: v.result.assertionId, runId: v.runId, detail: v.result.detail });
  }

  const html = renderReport({
    result,
    assertions: confirmed,
    ledger,
    periodStart: timeline.startedAt,
    periodEnd: timeline.now,
    clientName: 'Fernweh Supply',
    preparedBy: 'ops@agency.example',
    platform: platformSummary(timeline),
  });
  writeFileSync(outPath, html, 'utf8');
  console.log(`Report written to ${outPath}`);
}

async function main(): Promise<void> {
  const [command = 'demo', ...rest] = process.argv.slice(2);
  switch (command) {
    case 'demo':
      return runDemo();
    case 'scan':
      return runScan();
    case 'report': {
      const i = rest.indexOf('--out');
      return runReport(i >= 0 ? rest[i + 1] ?? 'silentgreen-report.html' : 'silentgreen-report.html');
    }
    case 'help':
    case '--help':
    case '-h':
      console.log(`silentgreen

  demo                    the worked example, no credentials needed
  scan                    read an n8n instance and propose contracts
  report --out FILE.html  produce the client evidence report

  N8N_URL, N8N_API_KEY    read-only credentials for scan
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
