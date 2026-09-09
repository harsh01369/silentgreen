/**
 * Generates the data the landing page renders.
 *
 * The page must not contain hand-written numbers. Every figure it shows is
 * produced here by the same engine the CLI runs, so the site and the tool
 * cannot drift apart and quietly start disagreeing, which would be a slightly
 * humiliating failure for this particular product.
 */

import { writeFileSync } from 'node:fs';
import { demoWorkflow, demoTimeline, platformSummary, DEMO_WORKFLOW_ID } from '../src/demo/scenario';
import { findSinks } from '../src/contract/sinks';
import { proposeFromStructure, proposeFromObservation } from '../src/contract/infer';
import { confirmAssertion } from '../src/contract/circularity';
import { workflowHash, diffWorkflows } from '../src/graph/hash';
import { inferCadence } from '../src/verify/cadence';
import { audit } from '../src/audit';
import type { Assertion } from '../src/contract/types';

const healthy = demoWorkflow(false);
const edited = demoWorkflow(true);
const hash = workflowHash(healthy);
const editedHash = workflowHash(edited);
const timeline = demoTimeline();
const platform = platformSummary(timeline);

const healthyEnd = Date.parse(timeline.startedAt) + timeline.breakageDay * 86_400_000;
const healthyRuns = timeline.runs.filter((r) => Date.parse(r.startedAt) < healthyEnd);
const sinks = findSinks(healthy);

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
const shape = { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours };

const verified = audit({
  workflowId: DEMO_WORKFLOW_ID,
  workflowName: healthy.name ?? '',
  currentHash: hash,
  runs: timeline.runs,
  assertions: confirmed,
  now: new Date(timeline.now),
  cadenceShape: shape,
});

const afterEdit = audit({
  workflowId: DEMO_WORKFLOW_ID,
  workflowName: healthy.name ?? '',
  currentHash: editedHash,
  runs: timeline.runs,
  assertions: confirmed,
  now: new Date(timeline.now),
  cadenceShape: shape,
  previousDoc: healthy,
  currentDoc: edited,
});

// One cell per execution, in order, with the verdict verification reached.
const violatedRunIds = new Set(verified.violations.map((v) => v.runId).filter((x): x is string => Boolean(x)));
const cells = timeline.runs.map((r) => ({
  at: r.startedAt,
  platform: r.platformStatus,
  verdict: violatedRunIds.has(r.id) ? 'violated' : 'proven',
}));

// The findings, grouped, with the literal captured evidence.
const seen = new Map<string, { statement: string; basis: string; count: number; firstAt?: string; detail?: string; evidence?: string }>();
for (const v of verified.violations) {
  const prev = seen.get(v.result.assertionId);
  if (prev) prev.count += 1;
  else
    seen.set(v.result.assertionId, {
      statement: v.result.statement,
      basis: v.result.basis,
      count: 1,
      firstAt: v.at,
      detail: v.result.detail,
      evidence: v.result.evidence,
    });
}

const shrug = confirmAssertion(
  proposals.find((p) => p.assertion.basis === 'observation')!.assertion,
  {
    by: 'ops@agency.example',
    at: new Date(healthyEnd).toISOString(),
    workflowHash: hash,
    evidenceRunIds: ['exec_0_9'],
    baselineAttestation: { windowStart: timeline.startedAt, windowEnd: new Date(healthyEnd).toISOString(), howKnown: 'looks fine' },
  },
  { currentWorkflowHash: hash },
);

const data = {
  workflowName: healthy.name,
  weeks: 6,
  platform,
  cells,
  breakageIndex: cells.findIndex((c) => c.verdict === 'violated'),
  counts: verified.counts,
  runsExamined: verified.runsExamined,
  runsWithViolations: verified.runsWithViolations,
  headline: verified.headline,
  findings: [...seen.values()].sort((a, b) => b.count - a.count),
  honesty: verified.honesty,
  afterEdit: { counts: afterEdit.counts, drift: diffWorkflows(healthy, edited).map((d) => d.description) },
  cadenceReasoning: profile?.reasoning ?? '',
  proposals: proposals.map((p) => ({ statement: p.assertion.statement, basis: p.assertion.basis, rationale: p.rationale, confidence: p.confidence })),
  sinks: sinks.map((s) => ({ name: s.nodeName, category: s.category, rationale: s.rationale })),
  refusalMessage: 'refused' in shrug ? shrug.refused.message : '',
  generatedAt: new Date().toISOString(),
};

writeFileSync(new URL('./demo-data.js', import.meta.url), `window.SG = ${JSON.stringify(data, null, 2)};\n`, 'utf8');
console.log(`site/demo-data.js written: ${cells.length} executions, ${data.findings.length} findings, ${verified.counts.violated} violations.`);

/* ---- the AI work example, so the hero can show a real fabrication ---- */

import { demoTasks } from '../src/aiwork/demo';
import { checkBatch } from '../src/aiwork/check';
import { groundingSourcesFor } from '../src/aiwork/record';
import { checkGrounding } from '../src/verify/grounding';

const tasks = demoTasks();
const batch = checkBatch(tasks);

const fabricated = tasks.find((t) => t.id === 'task-004')!;
const fabricatedSources = groundingSourcesFor(fabricated).sources;
const fabricatedGrounding = checkGrounding(fabricated.output, fabricatedSources);

const aiData = {
  total: batch.summary.total,
  clean: batch.summary.clean,
  problematic: batch.summary.problematic,
  headline: batch.summary.headline,
  caveat: batch.summary.caveat,
  byKind: batch.summary.byKind,
  fabricated: {
    id: fabricated.id,
    output: fabricated.output,
    source: fabricatedSources.join('\n').trim(),
    ungrounded: fabricatedGrounding.ungrounded.map((u) => ({ text: u.text, kind: u.kind, why: u.why })),
  },
  flagged: batch.results
    .filter((r) => r.problems.length > 0)
    .map((r) => ({
      id: r.id,
      output: (tasks.find((t) => t.id === r.id)?.output ?? '').slice(0, 220),
      problems: r.problems.map((p) => ({ kind: p.kind, summary: p.summary, evidence: p.evidence.slice(0, 200) })),
    })),
};

writeFileSync(
  new URL('./ai-data.js', import.meta.url),
  `window.SGAI = ${JSON.stringify(aiData, null, 2)};\n`,
  'utf8',
);
console.log(`docs/ai-data.js written: ${aiData.total} tasks, ${aiData.problematic} flagged, ${aiData.fabricated.ungrounded.length} invented facts in the example.`);
