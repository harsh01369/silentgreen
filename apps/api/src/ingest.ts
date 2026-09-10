/**
 * Ingesting a batch.
 *
 * Runs the engine (imported, never reimplemented), stores the per-task
 * verdicts, and appends one entry to the project's hash chain. Evidence is
 * redacted before it is written: the free tier keeps the shape of a finding,
 * never the personal value inside it.
 */

import { randomUUID } from 'node:crypto';
import { checkBatch, hashEntry, type TaskRecord } from 'silentgreen';
import { and, desc, eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { batch, ledgerEntry, problem, taskResult } from './db/schema.js';

const GENESIS_PREV = '0'.repeat(64);

/**
 * A finding's evidence can itself contain personal data (an invented email, a
 * snippet of the model's output). Keep the kind and a structural hint, drop the
 * value.
 */
function redact(kind: string, evidence: string): string {
  const len = evidence.trim().length;
  if (kind === 'ungrounded') {
    const looksLike = /@/.test(evidence)
      ? 'an email address'
      : /https?:\/\//.test(evidence)
        ? 'a URL'
        : /[£$€¥]|\bGBP|USD|EUR\b/.test(evidence)
          ? 'a monetary amount'
          : /^\d{4}-\d{2}-\d{2}/.test(evidence.trim())
            ? 'a date'
            : /^[A-Z0-9][A-Z0-9-]{3,}$/.test(evidence.trim())
              ? 'an identifier'
              : 'a value';
    return `${looksLike}, ${len} characters, not found in the source`;
  }
  return `${kind}, ${len} characters of output`;
}

export interface IngestInput {
  readonly projectId: string;
  readonly records: readonly TaskRecord[];
  readonly source?: string;
  readonly uploadedBy?: string;
  readonly unreadableLines?: number;
}

export interface IngestResult {
  readonly batchId: string;
  readonly summary: {
    readonly total: number;
    readonly clean: number;
    readonly problematic: number;
    readonly inconclusive: number;
    readonly headline: string;
    readonly caveat: string;
    readonly byKind: Readonly<Record<string, number>>;
    readonly signals: readonly { kind: string; severity: string; summary: string; sampleTaskIds: readonly string[] }[];
  };
  readonly ledger: { readonly seq: number; readonly hash: string };
}

export async function ingestBatch(input: IngestInput): Promise<IngestResult> {
  const { results, summary } = checkBatch(input.records);
  const batchId = randomUUID();
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(batch).values({
      id: batchId,
      projectId: input.projectId,
      source: input.source ?? null,
      taskCount: summary.total,
      cleanCount: summary.clean,
      problematic: summary.problematic,
      inconclusive: summary.inconclusive,
      unreadableLines: input.unreadableLines ?? 0,
      signals: summary.signals,
      uploadedBy: input.uploadedBy ?? null,
      uploadedAt: now,
    });

    const charsById = new Map(input.records.map((rec) => [rec.id, rec.output.length]));

    for (const r of results) {
      const trId = randomUUID();
      await tx.insert(taskResult).values({
        id: trId,
        batchId,
        taskId: r.id,
        verdict: r.problems.length > 0 ? 'problem' : r.inconclusive ? 'inconclusive' : 'clean',
        atomsChecked: r.atomsChecked,
        answerChars: charsById.get(r.id) ?? 0,
        inconclusiveReason: r.inconclusiveReason ?? null,
        at: r.at ? new Date(r.at) : null,
      });
      if (r.problems.length > 0) {
        await tx.insert(problem).values(
          r.problems.map(
            (p: { kind: string; summary: string; evidence: string; span?: { start: number; end: number; atomKind: string } }) => ({
              id: randomUUID(),
              taskResultId: trId,
              kind: p.kind,
              summary: p.summary,
              evidenceRedacted: redact(p.kind, p.evidence),
              span: p.span ?? null,
            }),
          ),
        );
      }
    }

    // Append to the project's hash chain.
    const [last] = await tx
      .select({ seq: ledgerEntry.seq, hash: ledgerEntry.hash })
      .from(ledgerEntry)
      .where(eq(ledgerEntry.projectId, input.projectId))
      .orderBy(desc(ledgerEntry.seq))
      .limit(1);

    const seq = (last?.seq ?? -1) + 1;
    const prevHash = last?.hash ?? GENESIS_PREV;
    const payload = {
      batchId,
      total: summary.total,
      clean: summary.clean,
      problematic: summary.problematic,
      inconclusive: summary.inconclusive,
      byKind: summary.byKind,
    };
    const at = now.toISOString();
    const hash = hashEntry({ seq, at, kind: 'run-verified', workflowId: input.projectId, payload, prevHash });

    await tx.insert(ledgerEntry).values({ id: randomUUID(), projectId: input.projectId, seq, hash, prevHash, payload, at: now });

    return { seq, hash };
  });

  return {
    batchId,
    summary: {
      total: summary.total,
      clean: summary.clean,
      problematic: summary.problematic,
      inconclusive: summary.inconclusive,
      headline: summary.headline,
      caveat: summary.caveat,
      byKind: summary.byKind,
      signals: summary.signals,
    },
    ledger: await lastLedger(input.projectId),
  };
}

async function lastLedger(projectId: string): Promise<{ seq: number; hash: string }> {
  const [row] = await db
    .select({ seq: ledgerEntry.seq, hash: ledgerEntry.hash })
    .from(ledgerEntry)
    .where(eq(ledgerEntry.projectId, projectId))
    .orderBy(desc(ledgerEntry.seq))
    .limit(1);
  return row ?? { seq: -1, hash: GENESIS_PREV };
}

export { and, eq };
