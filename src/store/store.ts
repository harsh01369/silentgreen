/**
 * Persistence.
 *
 * A contract that does not survive the process is a demo. Everything that makes
 * this useful happens across time: you scan on Monday, confirm a handful of
 * expectations on Tuesday, and on Friday something breaks and the check that
 * was confirmed on Tuesday is what catches it.
 *
 * The store is a directory of plain files rather than a database, for a reason
 * the buyers stated themselves:
 *
 *   "They all wanted to become the system of record, and the boring file
 *    already is."
 *
 * So: readable JSON you can diff, commit, grep and delete. If you remove the
 * directory you lose the history of what was confirmed and nothing else breaks.
 * The ledger is append-only JSONL beside it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Assertion, Confirmation, Platform, Run } from '../contract/types';
import type { N8nWorkflowDoc } from '../graph/hash';
import { diffWorkflows, type Change } from '../graph/hash';
import { Ledger } from '../ledger/chain';
import { confirmAssertion, type Refusal } from '../contract/circularity';

export const STORE_DIR = '.silentgreen';
const STATE_FILE = 'state.json';
const LEDGER_FILE = 'ledger.jsonl';
const STATE_VERSION = 1;

/** How many captured items to keep per sink so a reviewer sees real values. */
const SAMPLES_PER_SINK = 4;

export interface StoredWorkflow {
  readonly id: string;
  readonly platform: Platform;
  name: string;
  active: boolean;
  /** Semantic revision hash as of the last scan. */
  hash: string;
  /** The graph as of the last scan, kept so the next scan can explain what moved. */
  doc: N8nWorkflowDoc;
  /** The graph as of the scan before that, for the same reason. */
  previousDoc?: N8nWorkflowDoc;
  previousHash?: string;
  clientId?: string;
  lastScannedAt: string;
  /** Learned working shape, so absence checks do not fire out of hours. */
  cadenceShape?: { weekdaysOnly?: boolean; activeHours?: { from: number; to: number } };
  /**
   * A few real captured items per sink. The review interface shows these, because
   * confirming an expectation without seeing what it will be judging is the habit
   * this whole design exists to interrupt.
   */
  samples: Record<string, unknown[]>;
  /** Ids of the runs those samples came from, recorded on every confirmation. */
  sampleRunIds: string[];
  /**
   * The period the observed expectations were learned from.
   *
   * This is what the reviewer is being asked to attest to, so the interface
   * prefills it. Making somebody guess the dates of a window the tool already
   * knows is friction that teaches people to click past the question, and the
   * question is the entire mechanism.
   */
  observedWindow?: { start: string; end: string };
}

export interface StateShape {
  version: number;
  workflows: Record<string, StoredWorkflow>;
  assertions: Assertion[];
  clients: Record<string, { name: string }>;
}

function emptyState(): StateShape {
  return { version: STATE_VERSION, workflows: {}, assertions: [], clients: {} };
}

export class Store {
  private state: StateShape;
  readonly ledger: Ledger;

  constructor(readonly dir: string = STORE_DIR) {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, STATE_FILE);
    if (existsSync(path)) {
      try {
        this.state = JSON.parse(readFileSync(path, 'utf8')) as StateShape;
      } catch (err) {
        // Refusing to start beats silently continuing on a corrupt store and
        // reporting green about expectations we can no longer read.
        throw new Error(
          `${path} could not be parsed, so the confirmed expectations cannot be read. ` +
            `Move it aside and rescan rather than continuing, because a store that half-loads is worse than none. (${String(err)})`,
        );
      }
      if (this.state.version !== STATE_VERSION) {
        throw new Error(`${path} was written by a different version of this tool (found ${this.state.version}, expected ${STATE_VERSION}).`);
      }
    } else {
      this.state = emptyState();
    }
    this.ledger = new Ledger(join(dir, LEDGER_FILE));
  }

  save(): void {
    // Write then rename, so an interrupted save cannot truncate the file that
    // holds every confirmation anybody has made.
    const finalPath = join(this.dir, STATE_FILE);
    const tmp = `${finalPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(tmp, finalPath);
  }

  workflows(): readonly StoredWorkflow[] {
    return Object.values(this.state.workflows);
  }

  workflow(id: string): StoredWorkflow | undefined {
    return this.state.workflows[id];
  }

  assertions(workflowId?: string): readonly Assertion[] {
    return workflowId ? this.state.assertions.filter((a) => a.workflowId === workflowId) : this.state.assertions;
  }

  assertion(id: string): Assertion | undefined {
    return this.state.assertions.find((a) => a.id === id);
  }

  clients(): Record<string, { name: string }> {
    return this.state.clients;
  }

  setClient(workflowId: string, clientId: string, clientName?: string): void {
    const wf = this.state.workflows[workflowId];
    if (!wf) return;
    wf.clientId = clientId;
    if (!this.state.clients[clientId]) this.state.clients[clientId] = { name: clientName ?? clientId };
    else if (clientName) this.state.clients[clientId].name = clientName;
  }

  /**
   * Record a workflow as it is right now.
   *
   * If the graph has changed since the last scan, every confirmed expectation
   * bound to the old revision becomes stale, the change is written to the ledger
   * with a human-readable description, and those checks start reporting
   * `unproven` rather than continuing to describe a graph that no longer exists.
   */
  observeWorkflow(args: {
    id: string;
    platform: Platform;
    name: string;
    active: boolean;
    hash: string;
    doc: N8nWorkflowDoc;
    runs: readonly Run[];
    cadenceShape?: StoredWorkflow['cadenceShape'];
  }): { readonly changes: readonly Change[]; readonly staled: number } {
    const existing = this.state.workflows[args.id];
    let changes: readonly Change[] = [];
    let staled = 0;

    if (existing && existing.hash !== args.hash) {
      changes = diffWorkflows(existing.doc, args.doc);
      const now = new Date().toISOString();
      for (const a of this.state.assertions) {
        if (a.workflowId !== args.id) continue;
        if (a.status !== 'confirmed') continue;
        const idx = this.state.assertions.indexOf(a);
        this.state.assertions[idx] = {
          ...a,
          status: 'stale',
          stale: { since: now, fromHash: existing.hash, toHash: args.hash },
        };
        staled += 1;
      }
      this.ledger.append(
        'contract-stale',
        args.id,
        {
          fromHash: existing.hash,
          toHash: args.hash,
          staledAssertions: staled,
          changes: changes.map((c) => c.description),
        },
        { clientId: existing.clientId },
      );
    }

    const samples: Record<string, unknown[]> = {};
    const sampleRunIds: string[] = [];
    // One item per sink per run, so the samples span several runs rather than
    // showing four consecutive rows from a single execution. A reviewer judging
    // "is this expectation right" needs to see variation, not repetition.
    for (const run of args.runs.slice(0, 12)) {
      let used = false;
      for (const [sinkId, items] of Object.entries(run.sinkOutputs)) {
        const bucket = samples[sinkId] ?? (samples[sinkId] = []);
        if (bucket.length >= SAMPLES_PER_SINK) continue;
        if (items.length === 0) continue;
        bucket.push(items[0]);
        used = true;
      }
      if (used) sampleRunIds.push(run.id);
    }

    const times = args.runs
      .map((r) => Date.parse(r.startedAt))
      .filter((t) => Number.isFinite(t))
      .sort((a, b) => a - b);
    const observedWindow =
      times.length > 0
        ? { start: new Date(times[0]!).toISOString(), end: new Date(times[times.length - 1]!).toISOString() }
        : existing?.observedWindow;

    this.state.workflows[args.id] = {
      id: args.id,
      platform: args.platform,
      name: args.name,
      active: args.active,
      hash: args.hash,
      doc: args.doc,
      previousDoc: existing && existing.hash !== args.hash ? existing.doc : existing?.previousDoc,
      previousHash: existing && existing.hash !== args.hash ? existing.hash : existing?.previousHash,
      clientId: existing?.clientId,
      lastScannedAt: new Date().toISOString(),
      cadenceShape: args.cadenceShape ?? existing?.cadenceShape,
      samples,
      sampleRunIds,
      observedWindow,
    };

    if (!existing) {
      this.ledger.append('workflow-observed', args.id, { name: args.name, hash: args.hash, active: args.active });
    }

    return { changes, staled };
  }

  /**
   * Add proposals, skipping any that duplicate an expectation already on file.
   *
   * A scan that re-proposes the same forty checks every night would train people
   * to clear the queue without reading it, which defeats the only mechanism that
   * makes any of this mean anything.
   */
  addProposals(proposals: readonly { assertion: Assertion; rationale: string; confidence: string }[]): {
    readonly added: number;
    readonly skipped: number;
  } {
    let added = 0;
    let skipped = 0;
    for (const p of proposals) {
      const dup = this.state.assertions.some(
        (a) =>
          a.workflowId === p.assertion.workflowId &&
          a.sinkId === p.assertion.sinkId &&
          a.kind === p.assertion.kind &&
          a.basis === p.assertion.basis &&
          a.status !== 'retired',
      );
      if (dup) {
        skipped += 1;
        continue;
      }
      this.state.assertions.push({ ...p.assertion, rationale: p.rationale, confidence: p.confidence } as Assertion & {
        rationale: string;
        confidence: string;
      });
      added += 1;
    }
    if (added > 0) {
      const wfId = proposals[0]?.assertion.workflowId ?? '';
      this.ledger.append('proposal-made', wfId, { added, skipped }, { clientId: this.state.workflows[wfId]?.clientId });
    }
    return { added, skipped };
  }

  /** Put a proposal through the gate. Refusals are recorded too. */
  confirm(assertionId: string, confirmation: Confirmation): { ok: true } | { ok: false; refusal: Refusal } {
    const idx = this.state.assertions.findIndex((a) => a.id === assertionId);
    if (idx < 0) return { ok: false, refusal: { reason: 'retired', message: 'That expectation is not in the store.' } };
    const a = this.state.assertions[idx]!;
    const wf = this.state.workflows[a.workflowId];
    const result = confirmAssertion(a, confirmation, { currentWorkflowHash: wf?.hash ?? '' });

    if ('refused' in result) {
      this.ledger.append(
        'assertion-refused',
        a.workflowId,
        { assertionId, statement: a.statement, reason: result.refused.reason, by: confirmation.by },
        { clientId: wf?.clientId },
      );
      return { ok: false, refusal: result.refused };
    }

    this.state.assertions[idx] = result.assertion;
    this.ledger.append(
      'assertion-confirmed',
      a.workflowId,
      {
        assertionId,
        statement: a.statement,
        basis: a.basis,
        by: confirmation.by,
        workflowHash: confirmation.workflowHash,
        evidenceRunIds: confirmation.evidenceRunIds,
        // The attestation is recorded verbatim, because it is printed beside
        // every green tick it goes on to produce.
        baselineAttestation: confirmation.baselineAttestation,
      },
      { clientId: wf?.clientId },
    );
    return { ok: true };
  }

  retire(assertionId: string, by: string, why: string): boolean {
    const idx = this.state.assertions.findIndex((a) => a.id === assertionId);
    if (idx < 0) return false;
    const a = this.state.assertions[idx]!;
    this.state.assertions[idx] = { ...a, status: 'retired' };
    this.ledger.append(
      'assertion-retired',
      a.workflowId,
      { assertionId, statement: a.statement, by, why },
      { clientId: this.state.workflows[a.workflowId]?.clientId },
    );
    return true;
  }

  counts(workflowId?: string): { proposed: number; confirmed: number; stale: number; retired: number } {
    const list = this.assertions(workflowId);
    return {
      proposed: list.filter((a) => a.status === 'proposed').length,
      confirmed: list.filter((a) => a.status === 'confirmed').length,
      stale: list.filter((a) => a.status === 'stale').length,
      retired: list.filter((a) => a.status === 'retired').length,
    };
  }
}
