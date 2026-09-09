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
import type { Assertion, Confirmation, Platform, Run } from '../contract/types';
import type { N8nWorkflowDoc } from '../graph/hash';
import { type Change } from '../graph/hash';
import { Ledger } from '../ledger/chain';
import { type Refusal } from '../contract/circularity';
import type { AlertRecord, AlertState } from '../alert/state';
export declare const STORE_DIR = ".silentgreen";
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
    cadenceShape?: {
        weekdaysOnly?: boolean;
        activeHours?: {
            from: number;
            to: number;
        };
    };
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
    observedWindow?: {
        start: string;
        end: string;
    };
}
export interface StateShape {
    version: number;
    workflows: Record<string, StoredWorkflow>;
    assertions: Assertion[];
    clients: Record<string, {
        name: string;
    }>;
    /**
     * Which checks are currently the subject of an open alert, so a failure that
     * lasts a fortnight produces a handful of messages rather than a fortnight of
     * them. Keyed by assertion id.
     */
    alerts: Record<string, AlertRecord>;
}
export declare class Store {
    readonly dir: string;
    private state;
    readonly ledger: Ledger;
    constructor(dir?: string);
    save(): void;
    workflows(): readonly StoredWorkflow[];
    workflow(id: string): StoredWorkflow | undefined;
    assertions(workflowId?: string): readonly Assertion[];
    assertion(id: string): Assertion | undefined;
    alerts(): AlertState;
    setAlerts(next: AlertState): void;
    clients(): Record<string, {
        name: string;
    }>;
    setClient(workflowId: string, clientId: string, clientName?: string): void;
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
    }): {
        readonly changes: readonly Change[];
        readonly staled: number;
    };
    /**
     * Add proposals, skipping any that duplicate an expectation already on file.
     *
     * A scan that re-proposes the same forty checks every night would train people
     * to clear the queue without reading it, which defeats the only mechanism that
     * makes any of this mean anything.
     */
    addProposals(proposals: readonly {
        assertion: Assertion;
        rationale: string;
        confidence: string;
    }[]): {
        readonly added: number;
        readonly skipped: number;
    };
    /** Put a proposal through the gate. Refusals are recorded too. */
    confirm(assertionId: string, confirmation: Confirmation): {
        ok: true;
    } | {
        ok: false;
        refusal: Refusal;
    };
    retire(assertionId: string, by: string, why: string): boolean;
    counts(workflowId?: string): {
        proposed: number;
        confirmed: number;
        stale: number;
        retired: number;
    };
}
