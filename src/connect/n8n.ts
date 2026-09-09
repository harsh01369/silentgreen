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
import { workflowHash, type N8nWorkflowDoc } from '../graph/hash';

export interface N8nClientOptions {
  /** e.g. https://n8n.example.com  or  https://your-tenant.app.n8n.cloud */
  readonly baseUrl: string;
  /** Settings, n8n API, create an API key. Read scopes are sufficient. */
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export class N8nError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'N8nError';
  }
}

interface N8nExecutionRaw {
  readonly id: number | string;
  readonly workflowId?: string;
  readonly startedAt?: string;
  readonly stoppedAt?: string;
  readonly finished?: boolean;
  readonly status?: string;
  readonly mode?: string;
  readonly data?: {
    readonly resultData?: {
      readonly runData?: Record<string, ReadonlyArray<{ readonly data?: { readonly main?: ReadonlyArray<ReadonlyArray<{ readonly json?: unknown }> | null> } }>>;
      readonly lastNodeExecuted?: string;
    };
  };
  readonly workflowData?: N8nWorkflowDoc;
}

export class N8nClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly f: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: N8nClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.f = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  private async get<T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.f(url.toString(), {
        method: 'GET',
        headers: { 'X-N8N-API-KEY': this.apiKey, accept: 'application/json' },
        signal: ac.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg)) {
        throw new N8nError(`n8n did not respond within ${this.timeoutMs / 1000}s`, undefined, 'Check the base URL is reachable from this machine.');
      }
      throw new N8nError(`Could not reach n8n at ${this.baseUrl}: ${msg}`, undefined, 'Include the scheme, for example https://n8n.example.com, and no trailing /api/v1.');
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 401) {
      throw new N8nError('n8n rejected the API key (401).', 401, 'Create a key under Settings, n8n API. On n8n Cloud the base URL is https://<tenant>.app.n8n.cloud.');
    }
    if (res.status === 404) {
      throw new N8nError(`n8n returned 404 for ${path}.`, 404, 'The public API is disabled on some self-hosted setups; set N8N_PUBLIC_API_DISABLED=false.');
    }
    if (!res.ok) {
      throw new N8nError(`n8n returned ${res.status} for ${path}.`, res.status);
    }

    return (await res.json()) as T;
  }

  /** Every workflow the key can see, with its semantic revision hash. */
  async listWorkflows(): Promise<readonly WorkflowRef[]> {
    const out: WorkflowRef[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.get<{ data: ReadonlyArray<N8nWorkflowDoc & { active?: boolean }>; nextCursor?: string }>(
        '/workflows',
        { limit: 100, cursor },
      );
      for (const wf of page.data ?? []) {
        if (!wf.id) continue;
        out.push({
          id: String(wf.id),
          platform: 'n8n',
          name: wf.name ?? '(unnamed)',
          active: wf.active === true,
          hash: workflowHash(wf),
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  }

  async getWorkflow(id: string): Promise<N8nWorkflowDoc> {
    return this.get<N8nWorkflowDoc>(`/workflows/${encodeURIComponent(id)}`);
  }

  /**
   * Recent executions for one workflow.
   *
   * `includeData` is expensive and is the only way to see what a run actually
   * produced, so it is opt-in: cadence work needs only timestamps, while
   * verification needs the payloads.
   */
  async listRuns(workflowId: string, opts: { limit?: number; includeData?: boolean } = {}): Promise<readonly Run[]> {
    const limit = opts.limit ?? 50;
    const includeData = opts.includeData ?? false;

    // The node id mapping has to come from the workflow document, because
    // executions speak in names.
    const doc = await this.getWorkflow(workflowId);
    const nameToId = new Map<string, string>();
    for (const n of doc.nodes ?? []) nameToId.set(n.name, n.id && n.id.trim() ? n.id : `name:${n.name}`);
    const triggerNames = new Set(
      (doc.nodes ?? [])
        .filter((n) => /trigger|webhook/i.test(n.type))
        .map((n) => n.name),
    );

    const runs: Run[] = [];
    let cursor: string | undefined;
    while (runs.length < limit) {
      const page = await this.get<{ data: readonly N8nExecutionRaw[]; nextCursor?: string }>('/executions', {
        workflowId,
        limit: Math.min(100, limit - runs.length),
        includeData,
        cursor,
      });
      const batch = page.data ?? [];
      if (batch.length === 0) break;
      for (const raw of batch) {
        runs.push(this.normaliseRun(raw, workflowId, nameToId, triggerNames));
      }
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    return runs;
  }

  /** One execution with its payloads, for close inspection. */
  async getRun(executionId: string, workflowId: string): Promise<Run> {
    const doc = await this.getWorkflow(workflowId);
    const nameToId = new Map<string, string>();
    for (const n of doc.nodes ?? []) nameToId.set(n.name, n.id && n.id.trim() ? n.id : `name:${n.name}`);
    const triggerNames = new Set((doc.nodes ?? []).filter((n) => /trigger|webhook/i.test(n.type)).map((n) => n.name));
    const raw = await this.get<N8nExecutionRaw>(`/executions/${encodeURIComponent(executionId)}`, { includeData: true });
    return this.normaliseRun(raw, workflowId, nameToId, triggerNames);
  }

  private normaliseRun(
    raw: N8nExecutionRaw,
    workflowId: string,
    nameToId: Map<string, string>,
    triggerNames: ReadonlySet<string>,
  ): Run {
    const runData = raw.data?.resultData?.runData ?? {};
    const sinkOutputs: Record<string, readonly unknown[]> = {};
    let triggerInput: unknown[] | undefined;

    for (const [nodeName, taskRuns] of Object.entries(runData)) {
      const items: unknown[] = [];
      for (const task of taskRuns ?? []) {
        for (const branch of task.data?.main ?? []) {
          for (const item of branch ?? []) {
            // n8n wraps every item as { json, binary }. The json is the payload
            // a contract talks about; binary is deliberately not read.
            items.push(item?.json ?? null);
          }
        }
      }
      const id = nameToId.get(nodeName);
      // A node present in the execution but absent from the current workflow
      // document was renamed or deleted after this run. Keyed by name so the
      // history is not silently dropped, and clearly marked as unresolved.
      sinkOutputs[id ?? `unresolved:${nodeName}`] = items;
      if (triggerNames.has(nodeName)) triggerInput = items;
    }

    return {
      id: String(raw.id),
      workflowId: raw.workflowId ? String(raw.workflowId) : workflowId,
      platform: 'n8n',
      startedAt: raw.startedAt ?? new Date(0).toISOString(),
      finishedAt: raw.stoppedAt,
      platformStatus: mapStatus(raw),
      sinkOutputs,
      triggerInput,
    };
  }
}

function mapStatus(raw: N8nExecutionRaw): Run['platformStatus'] {
  const s = (raw.status ?? '').toLowerCase();
  if (s === 'success') return 'success';
  if (s === 'error' || s === 'crashed' || s === 'failed') return 'error';
  if (s === 'running' || s === 'new') return 'running';
  if (s === 'waiting') return 'waiting';
  if (raw.finished === true) return 'success';
  return 'unknown';
}
