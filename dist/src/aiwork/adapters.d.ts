/**
 * Recognising what LangSmith and Langfuse hand you.
 *
 * Both store exactly the shape this tool needs (a question, the material, the
 * answer) but bury it under their own nesting: LangChain puts everything under
 * `inputs`/`outputs` with the retrieved documents in a child run, Langfuse uses
 * singular `input`/`output` with the retrieval step as an observation.
 *
 * This module pulls the flat shape back out. It is best-effort and additive:
 * whatever it finds is offered as a fallback, and the original keys are left in
 * place so the generic parser still runs. If it recognises nothing it returns
 * nothing and no harm is done.
 */
type Obj = Record<string, unknown>;
export interface TraceExtract {
    readonly input?: string;
    readonly output?: string;
    readonly sources?: readonly string[];
    readonly id?: string;
    readonly at?: string;
}
/**
 * Given a raw exported object, return the flat fields we could recover from a
 * recognised trace shape. Empty object if nothing was recognised.
 */
export declare function extractTrace(obj: Obj): TraceExtract;
export {};
