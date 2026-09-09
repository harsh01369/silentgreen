/**
 * Semantic identity of a workflow.
 *
 * A check written against a workflow is only meaningful while that workflow is
 * the thing it was written against. The community thread put it exactly right:
 * "the output check you write this week will be muted within a month". Checks
 * do not usually get deleted. They get quietly outlived, and then they report
 * green about a graph that no longer exists.
 *
 * So a contract is bound to a revision hash. The hash has to be strict about
 * meaning and blind to cosmetics, otherwise it is useless in both directions: a
 * hash that changes when someone drags a node two pixels invalidates contracts
 * for no reason and trains people to click through the warning, and a hash that
 * ignores parameters lets a rewritten HTTP target sail past a stale check.
 *
 * n8n keys its `connections` map by node NAME, so renaming a node rewrites a
 * large part of the document without changing the graph. We resolve names to
 * ids first and hash the id-keyed form, which makes a rename cosmetic and a
 * rewiring semantic. That is the correct split.
 */

import { createHash } from 'node:crypto';

/** The shape we care about from an n8n workflow export. Extra keys are ignored. */
export interface N8nWorkflowDoc {
  readonly id?: string;
  readonly name?: string;
  readonly nodes?: readonly N8nNode[];
  readonly connections?: Readonly<Record<string, N8nNodeConnections>>;
  readonly settings?: Readonly<Record<string, unknown>>;
}

export interface N8nNode {
  readonly id?: string;
  readonly name: string;
  readonly type: string;
  readonly typeVersion?: number;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly credentials?: Readonly<Record<string, unknown>>;
  readonly disabled?: boolean;
  readonly position?: readonly number[];
  readonly notes?: string;
  readonly notesInFlow?: boolean;
  readonly color?: string;
}

export type N8nNodeConnections = Readonly<Record<string, ReadonlyArray<ReadonlyArray<N8nConnection>>>>;

export interface N8nConnection {
  readonly node: string;
  readonly type?: string;
  readonly index?: number;
}

/**
 * Keys that describe how a node looks or reads, never what it does.
 * Changing any of these must not invalidate a contract.
 */
const COSMETIC_NODE_KEYS = new Set(['position', 'notes', 'notesInFlow', 'color', 'name']);

/**
 * Parameter keys that are presentation only. Kept deliberately short: when in
 * doubt a parameter is semantic, because a false "unchanged" is the dangerous
 * direction. A false "changed" merely asks a human to re-read a check.
 */
const COSMETIC_PARAM_KEYS = new Set(['notice', '__rl_display', 'cachedResultName', 'cachedResultUrl']);

export interface CanonicalNode {
  readonly id: string;
  readonly type: string;
  readonly typeVersion: number;
  readonly disabled: boolean;
  readonly parameters: unknown;
  /** Credential *slots* matter, credential values are never read. */
  readonly credentialTypes: readonly string[];
}

export interface CanonicalEdge {
  readonly from: string;
  readonly outputType: string;
  readonly outputIndex: number;
  readonly to: string;
  readonly inputIndex: number;
}

export interface CanonicalWorkflow {
  readonly nodes: readonly CanonicalNode[];
  readonly edges: readonly CanonicalEdge[];
  /** Settings that change execution semantics, not editor preferences. */
  readonly settings: unknown;
}

/**
 * Node identity. n8n has carried a per-node `id` for several versions, but
 * older exports and hand-written fixtures may not, so we fall back to the name.
 * Falling back means a rename looks semantic on those documents, which is the
 * safe direction to be wrong in.
 */
function nodeKey(n: N8nNode): string {
  return n.id && n.id.trim() ? n.id : `name:${n.name}`;
}

/** Recursively sort object keys so JSON.stringify is order-independent. */
function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (COSMETIC_PARAM_KEYS.has(k)) continue;
      out[k] = sortValue((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

export function canonicalise(doc: N8nWorkflowDoc): CanonicalWorkflow {
  const nodes = doc.nodes ?? [];
  const nameToKey = new Map<string, string>();
  for (const n of nodes) nameToKey.set(n.name, nodeKey(n));

  const canonicalNodes: CanonicalNode[] = nodes
    .map((n) => {
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(n.parameters ?? {})) {
        if (COSMETIC_NODE_KEYS.has(k) || COSMETIC_PARAM_KEYS.has(k)) continue;
        params[k] = v;
      }
      return {
        id: nodeKey(n),
        type: n.type,
        typeVersion: n.typeVersion ?? 1,
        disabled: n.disabled === true,
        parameters: sortValue(params),
        credentialTypes: Object.keys(n.credentials ?? {}).sort(),
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const edges: CanonicalEdge[] = [];
  for (const [fromName, outputs] of Object.entries(doc.connections ?? {})) {
    const from = nameToKey.get(fromName);
    // A connection from a node that no longer exists is not a real edge.
    if (!from) continue;
    for (const [outputType, branches] of Object.entries(outputs)) {
      branches.forEach((branch, outputIndex) => {
        for (const c of branch ?? []) {
          const to = nameToKey.get(c.node);
          if (!to) continue;
          edges.push({
            from,
            outputType,
            outputIndex,
            to,
            inputIndex: c.index ?? 0,
          });
        }
      });
    }
  }

  edges.sort((a, b) => {
    const as = `${a.from}|${a.outputType}|${a.outputIndex}|${a.to}|${a.inputIndex}`;
    const bs = `${b.from}|${b.outputType}|${b.outputIndex}|${b.to}|${b.inputIndex}`;
    return as < bs ? -1 : as > bs ? 1 : 0;
  });

  return { nodes: canonicalNodes, edges, settings: sortValue(doc.settings ?? {}) };
}

export function workflowHash(doc: N8nWorkflowDoc): string {
  return createHash('sha256').update(JSON.stringify(canonicalise(doc))).digest('hex');
}

export type ChangeKind =
  | 'node-added'
  | 'node-removed'
  | 'node-type-changed'
  | 'node-version-changed'
  | 'node-parameters-changed'
  | 'node-enabled'
  | 'node-disabled'
  | 'node-credentials-changed'
  | 'edge-added'
  | 'edge-removed'
  | 'settings-changed';

export interface Change {
  readonly kind: ChangeKind;
  /** Node id where known, so a report can point at the thing that moved. */
  readonly nodeId?: string;
  /** One line, written for a person deciding whether a check still holds. */
  readonly description: string;
}

/**
 * What changed between two revisions.
 *
 * A stale contract is only actionable if we can say why it went stale. "Someone
 * edited the workflow" makes people click through. "The HTTP Request node's
 * parameters changed" makes them re-read the check that depended on it.
 */
export function diffWorkflows(before: N8nWorkflowDoc, after: N8nWorkflowDoc): readonly Change[] {
  const a = canonicalise(before);
  const b = canonicalise(after);
  const changes: Change[] = [];

  const aNodes = new Map(a.nodes.map((n) => [n.id, n]));
  const bNodes = new Map(b.nodes.map((n) => [n.id, n]));

  // Display names are cosmetic for hashing but useful in prose, so recover them.
  const displayName = new Map<string, string>();
  for (const n of after.nodes ?? []) displayName.set(nodeKey(n), n.name);
  for (const n of before.nodes ?? []) if (!displayName.has(nodeKey(n))) displayName.set(nodeKey(n), n.name);
  const label = (id: string) => displayName.get(id) ?? id;

  for (const [id, node] of bNodes) {
    if (!aNodes.has(id)) {
      changes.push({ kind: 'node-added', nodeId: id, description: `"${label(id)}" (${node.type}) was added.` });
    }
  }
  for (const [id, node] of aNodes) {
    if (!bNodes.has(id)) {
      changes.push({ kind: 'node-removed', nodeId: id, description: `"${label(id)}" (${node.type}) was removed. Any check bound to it can no longer be evaluated.` });
    }
  }

  for (const [id, an] of aNodes) {
    const bn = bNodes.get(id);
    if (!bn) continue;
    if (an.type !== bn.type) {
      changes.push({ kind: 'node-type-changed', nodeId: id, description: `"${label(id)}" changed from ${an.type} to ${bn.type}.` });
      continue; // A type change subsumes its parameter changes.
    }
    if (an.typeVersion !== bn.typeVersion) {
      changes.push({ kind: 'node-version-changed', nodeId: id, description: `"${label(id)}" moved from version ${an.typeVersion} to ${bn.typeVersion}, which can change its output shape.` });
    }
    if (JSON.stringify(an.parameters) !== JSON.stringify(bn.parameters)) {
      changes.push({ kind: 'node-parameters-changed', nodeId: id, description: `"${label(id)}" had its parameters changed.` });
    }
    if (an.disabled !== bn.disabled) {
      changes.push({
        kind: bn.disabled ? 'node-disabled' : 'node-enabled',
        nodeId: id,
        description: bn.disabled
          ? `"${label(id)}" was disabled, so anything downstream of it may now receive nothing while the run still reports success.`
          : `"${label(id)}" was re-enabled.`,
      });
    }
    if (an.credentialTypes.join(',') !== bn.credentialTypes.join(',')) {
      changes.push({ kind: 'node-credentials-changed', nodeId: id, description: `"${label(id)}" now uses different credential types.` });
    }
  }

  const edgeStr = (e: CanonicalEdge) => `${e.from}|${e.outputType}|${e.outputIndex}|${e.to}|${e.inputIndex}`;
  const aEdges = new Set(a.edges.map(edgeStr));
  const bEdges = new Set(b.edges.map(edgeStr));
  for (const e of b.edges) {
    if (!aEdges.has(edgeStr(e))) {
      changes.push({ kind: 'edge-added', description: `"${label(e.from)}" now feeds "${label(e.to)}".` });
    }
  }
  for (const e of a.edges) {
    if (!bEdges.has(edgeStr(e))) {
      changes.push({ kind: 'edge-removed', description: `"${label(e.from)}" no longer feeds "${label(e.to)}".` });
    }
  }

  if (JSON.stringify(a.settings) !== JSON.stringify(b.settings)) {
    changes.push({ kind: 'settings-changed', description: 'Workflow settings changed, which can affect error handling and execution order.' });
  }

  return changes;
}
