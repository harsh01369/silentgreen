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
export declare function canonicalise(doc: N8nWorkflowDoc): CanonicalWorkflow;
export declare function workflowHash(doc: N8nWorkflowDoc): string;
export type ChangeKind = 'node-added' | 'node-removed' | 'node-type-changed' | 'node-version-changed' | 'node-parameters-changed' | 'node-enabled' | 'node-disabled' | 'node-credentials-changed' | 'edge-added' | 'edge-removed' | 'settings-changed';
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
export declare function diffWorkflows(before: N8nWorkflowDoc, after: N8nWorkflowDoc): readonly Change[];
