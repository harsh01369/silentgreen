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

/* ------------------------------------------------- OpenTelemetry GenAI --- */

/**
 * The OpenTelemetry GenAI semantic conventions, which is the shape OpenLLMetry
 * (Traceloop), Arize, MLflow and a growing number of others emit. A span
 * carries the prompt and completion as attributes, either structured or as a
 * JSON string, under a handful of competing key styles as the convention has
 * churned:
 *
 *   gen_ai.input.messages / gen_ai.output.messages   (current)
 *   gen_ai.prompt / gen_ai.completion                (deprecated, still common)
 *   gen_ai.prompt.0.content / gen_ai.completion.0.content   (OpenLLMetry flat)
 *   traceloop.entity.input / traceloop.entity.output       (Traceloop workflows)
 *
 * Attributes may sit under `attributes` or be flattened onto the object.
 */

function attrs(o: Obj): Obj {
  const a = o.attributes ?? o.attr ?? o.tags;
  return isObj(a) ? { ...a, ...o } : o;
}

function parseMaybeJson(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return v;
  try {
    return JSON.parse(t);
  } catch {
    return v;
  }
}

/** A GenAI message value: {role, content} or {role, parts:[{content|text}]}. */
function genAiMessageText(v: unknown): string | undefined {
  const parsed = parseMaybeJson(v);
  if (typeof parsed === 'string') return parsed.trim() || undefined;
  if (Array.isArray(parsed)) {
    for (let i = parsed.length - 1; i >= 0; i--) {
      const t = genAiMessageText(parsed[i]);
      if (t) return t;
    }
    return undefined;
  }
  if (isObj(parsed)) {
    if (Array.isArray(parsed.parts)) {
      const parts = parsed.parts.map((p) => (isObj(p) ? str(p.content) ?? str(p.text) : str(p))).filter(Boolean);
      if (parts.length) return parts.join('\n');
    }
    if (Array.isArray(parsed.messages)) return genAiMessageText(parsed.messages);
    const named =
      str(parsed.content) ??
      str(parsed.text) ??
      str(parsed.answer) ??
      str(parsed.output) ??
      str(parsed.response) ??
      str(parsed.result) ??
      str(parsed.completion) ??
      str(parsed.question) ??
      str(parsed.query) ??
      str(parsed.input) ??
      str(parsed.prompt);
    if (named) return named;
    // A wrapper object with exactly one string value: use it.
    const strings = Object.values(parsed).filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (strings.length === 1) return strings[0];
    return undefined;
  }
  return undefined;
}

/**
 * Collect flattened message attributes in index order and return the last one's
 * text. Handles both `gen_ai.prompt.0.content` (OpenLLMetry) and
 * `llm.input_messages.0.message.content` (OpenInference / Arize).
 */
function flattenedRole(a: Obj, prefix: string): string | undefined {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)\\.(?:message\\.)?(?:content|text)$`);
  const rows: { i: number; content: string }[] = [];
  for (const [k, v] of Object.entries(a)) {
    const m = k.match(re);
    if (m && typeof v === 'string' && v.trim()) rows.push({ i: Number(m[1]), content: v });
  }
  if (rows.length === 0) return undefined;
  rows.sort((x, y) => x.i - y.i);
  return rows[rows.length - 1]!.content;
}

function hasGenAi(a: Obj): boolean {
  return Object.keys(a).some(
    (k) => k.startsWith('gen_ai.') || k.startsWith('llm.') || k.startsWith('traceloop.') || k === 'input.value' || k === 'output.value',
  );
}

function extractOtel(o: Obj): TraceExtract {
  const a = attrs(o);
  if (!hasGenAi(a)) return {};

  const input =
    genAiMessageText(a['gen_ai.input.messages']) ??
    genAiMessageText(a['gen_ai.prompt']) ??
    genAiMessageText(a['llm.input_messages']) ??
    flattenedRole(a, 'gen_ai.prompt') ??
    flattenedRole(a, 'llm.input_messages') ??
    (str(a['traceloop.entity.input']) ? genAiMessageText(a['traceloop.entity.input']) : undefined) ??
    str(a['gen_ai.request.instructions']) ??
    genAiMessageText(a['input.value']);

  const output =
    genAiMessageText(a['gen_ai.output.messages']) ??
    genAiMessageText(a['gen_ai.completion']) ??
    genAiMessageText(a['llm.output_messages']) ??
    flattenedRole(a, 'gen_ai.completion') ??
    flattenedRole(a, 'llm.output_messages') ??
    (str(a['traceloop.entity.output']) ? genAiMessageText(a['traceloop.entity.output']) : undefined) ??
    genAiMessageText(a['output.value']);

  // Retrieved documents: OpenLLMetry retrieval spans flatten them, and some
  // instrumentations put them on a `retrieval.documents` attribute.
  const sources: string[] = [];
  const docAttr = parseMaybeJson(a['retrieval.documents'] ?? a['gen_ai.retrieval.documents']);
  sources.push(...documentsFrom(docAttr));
  for (const [k, v] of Object.entries(a)) {
    if (/^(?:retrieval|gen_ai\.retrieval)\.documents?\.\d+\.(?:document\.)?content$/.test(k) && typeof v === 'string' && v.trim()) {
      sources.push(v);
    }
  }
  // Child spans named like a retrieval step.
  for (const key of ['spans', 'child_spans', 'childSpans', 'children']) {
    const kids = o[key];
    if (!Array.isArray(kids)) continue;
    for (const kid of kids) {
      if (!isObj(kid)) continue;
      if (!RETRIEVAL_NAME.test(str(kid.name) ?? '')) continue;
      const ka = attrs(kid);
      const kd = parseMaybeJson(ka['retrieval.documents']);
      sources.push(...documentsFrom(kd));
      for (const [k, v] of Object.entries(ka)) {
        if (/documents?\.\d+\.(?:document\.)?content$/.test(k) && typeof v === 'string' && v.trim()) sources.push(v);
      }
    }
  }

  const out: TraceExtract = {
    id: str(o.trace_id) ?? str(o.traceId) ?? str(o.span_id) ?? str(o.spanId) ?? str(o.id),
    at: str(o.start_time) ?? str(o.startTime) ?? str(o.timestamp) ?? str(a['gen_ai.request.time']),
  };
  if (input) (out as { input?: string }).input = input;
  if (output) (out as { output?: string }).output = output;
  const uniq = [...new Set(sources.filter((s) => s.trim().length > 0))];
  if (uniq.length) (out as { sources?: readonly string[] }).sources = uniq;
  return out;
}

/**
 * Given a raw exported object, return the flat fields we could recover from a
 * recognised trace shape. Empty object if nothing was recognised.
 */
export function extractTrace(obj: Obj): TraceExtract {
  const otel = extractOtel(obj);
  if (otel.output || otel.input) return otel;

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
