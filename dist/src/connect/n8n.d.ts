/**
 * Reading an n8n instance.
 *
 * Deliberately read-only. The agencies who described this problem were explicit
 * about what they would and would not install:
 *
 *   "They all wanted to become the system of record, and the boring file
 *    already is."
 *
 *   "Read-only next to my own file."
 *
 * So this client issues GETs and nothing else. There is no code path here that
 * writes to, activates, deactivates or deletes anything, and the README asks
 * for an API key scoped accordingly. A tool whose job is to tell you the truth
 * about your automations should not be able to become the reason they broke.
 *
 * One detail worth stating because it causes silent wrongness if missed: n8n
 * keys execution `runData` by node NAME, while the workflow document carries a
 * stable per-node `id`. Names get edited. If you index captured output by name
 * you will silently lose a node's history the day someone renames it, which is
 * exactly the class of quiet failure this product exists to catch. So every
 * capture is remapped onto ids before it leaves this module.
 */
import type { Run, WorkflowRef } from '../contract/types';
import { type N8nWorkflowDoc } from '../graph/hash';
export interface N8nClientOptions {
    /** e.g. https://n8n.example.com  or  https://your-tenant.app.n8n.cloud */
    readonly baseUrl: string;
    /** Settings, n8n API, create an API key. Read scopes are sufficient. */
    readonly apiKey: string;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
}
export declare class N8nError extends Error {
    readonly status?: number | undefined;
    readonly hint?: string | undefined;
    constructor(message: string, status?: number | undefined, hint?: string | undefined);
}
export declare class N8nClient {
    private readonly baseUrl;
    private readonly apiKey;
    private readonly f;
    private readonly timeoutMs;
    constructor(opts: N8nClientOptions);
    private get;
    /** Every workflow the key can see, with its semantic revision hash. */
    listWorkflows(): Promise<readonly WorkflowRef[]>;
    getWorkflow(id: string): Promise<N8nWorkflowDoc>;
    /**
     * Recent executions for one workflow.
     *
     * `includeData` is expensive and is the only way to see what a run actually
     * produced, so it is opt-in: cadence work needs only timestamps, while
     * verification needs the payloads.
     */
    listRuns(workflowId: string, opts?: {
        limit?: number;
        includeData?: boolean;
    }): Promise<readonly Run[]>;
    /** One execution with its payloads, for close inspection. */
    getRun(executionId: string, workflowId: string): Promise<Run>;
    private normaliseRun;
}
