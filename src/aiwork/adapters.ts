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

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/** Pull readable text out of whatever a message-ish value is. */
function messageText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (Array.isArray(v)) {
    // content parts: [{type:'text', text:'...'}]
    const parts = v.map((p) => (isObj(p) ? str(p.text) ?? str(p.content) : str(p))).filter(Boolean);
    if (parts.length) return parts.join('\n');
    return undefined;
  }
  if (isObj(v)) {
    // LangChain serialises messages as { kwargs: { content } } or { content }
    if (isObj(v.kwargs)) return messageText(v.kwargs.content) ?? messageText(v.kwargs);
    return messageText(v.content) ?? str(v.text) ?? str(v.value);
  }
  return undefined;
}

/** The last message in a list that may be nested one level and variously shaped. */
function lastMessage(v: unknown): string | undefined {
  let list = v;
  if (Array.isArray(list) && list.length === 1 && Array.isArray(list[0])) list = list[0];
  if (!Array.isArray(list) || list.length === 0) return undefined;
  for (let i = list.length - 1; i >= 0; i--) {
    const t = messageText(list[i]);
    if (t) return t;
  }
  return undefined;
}

function pickOutput(o: Obj): string | undefined {
  const out = o.outputs ?? o.output;
  if (str(out)) return str(out);
  if (isObj(out)) {
    // generations: [[{text|message}]] or [{text}]
    const gens = out.generations;
    if (Array.isArray(gens)) {
      const flat = (Array.isArray(gens[0]) ? gens[0] : gens) as unknown[];
      const first = flat[0];
      if (isObj(first)) {
        const t = str(first.text) ?? messageText(first.message) ?? messageText(first);
        if (t) return t;
      }
    }
    return (
      str(out.output) ??
      messageText(out.output) ??
      str(out.answer) ??
      str(out.result) ??
      str(out.text) ??
      str(out.content) ??
      messageText(out.content) ??
      lastMessage(out.messages)
    );
  }
  return undefined;
}

function pickInput(o: Obj): string | undefined {
  const inp = o.inputs ?? o.input;
  if (str(inp)) return str(inp);
  if (isObj(inp)) {
    return (
      str(inp.input) ??
      str(inp.question) ??
      str(inp.query) ??
      str(inp.prompt) ??
      str(inp.text) ??
      lastMessage(inp.messages) ??
      lastMessage(inp.chat_history)
    );
  }
  return undefined;
}

/** Documents in the many shapes a retrieval step emits them. */
function documentsFrom(v: unknown): string[] {
  const out: string[] = [];
  const push = (d: unknown) => {
    if (typeof d === 'string' && d.trim()) out.push(d);
    else if (isObj(d)) {
      const t = str(d.page_content) ?? str(d.pageContent) ?? str(d.text) ?? str(d.content) ?? str(d.chunk) ?? str(d.body);
      if (t) out.push(t);
    }
  };
  if (Array.isArray(v)) v.forEach(push);
  else if (isObj(v) && Array.isArray(v.documents)) (v.documents as unknown[]).forEach(push);
  return out;
}

const RETRIEVAL_NAME = /retriev|search|vector|embed|lookup|knowledge|rag|context|documents?/i;

function pickSources(o: Obj): string[] {
  const found: string[] = [];

  const out = o.outputs ?? o.output;
  if (isObj(out)) {
    found.push(...documentsFrom(out.documents ?? out.context ?? out.source_documents ?? out.sourceDocuments));
  }
  const inp = o.inputs ?? o.input;
  if (isObj(inp)) {
    found.push(...documentsFrom(inp.context ?? inp.documents ?? inp.retrieved ?? inp.chunks));
  }

  // LangChain child runs, Langfuse observations: a retrieval step nested inside.
  for (const key of ['child_runs', 'childRuns', 'children', 'observations', 'spans', 'steps']) {
    const kids = o[key];
    if (!Array.isArray(kids)) continue;
    for (const kid of kids) {
      if (!isObj(kid)) continue;
      const name = `${str(kid.run_type) ?? ''} ${str(kid.type) ?? ''} ${str(kid.name) ?? ''}`;
      const isRetrieval = RETRIEVAL_NAME.test(name);
      if (!isRetrieval) continue;
      const kidOut = kid.outputs ?? kid.output;
      found.push(...documentsFrom(kidOut));
      if (isObj(kidOut)) found.push(...documentsFrom(kidOut.documents ?? kidOut.context));
    }
  }

  if (isObj(o.metadata)) {
    found.push(...documentsFrom(o.metadata.context ?? o.metadata.retrieved_documents ?? o.metadata.documents));
  }

  return [...new Set(found.filter((s) => s.trim().length > 0))];
}

/**
 * Given a raw exported object, return the flat fields we could recover from a
 * recognised trace shape. Empty object if nothing was recognised.
 */
export function extractTrace(obj: Obj): TraceExtract {
  // Only engage if this looks like a trace rather than an already-flat record.
  const looksNested =
    isObj(obj.inputs) ||
    isObj(obj.outputs) ||
    isObj(obj.input) ||
    isObj(obj.output) ||
    Array.isArray(obj.observations) ||
    Array.isArray(obj.child_runs) ||
    Array.isArray(obj.childRuns);
  if (!looksNested) return {};

  const out: TraceExtract = {
    input: pickInput(obj),
    output: pickOutput(obj),
    sources: pickSources(obj),
    id: str(obj.id) ?? str(obj.trace_id) ?? str(obj.traceId) ?? str(obj.run_id),
    at: str(obj.start_time) ?? str(obj.startTime) ?? str(obj.timestamp) ?? str(obj.created_at),
  };
  return out;
}
