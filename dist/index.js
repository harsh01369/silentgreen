// src/aiwork/adapters.ts
var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var str = (v) => typeof v === "string" && v.trim() ? v : void 0;
function messageText(v) {
  if (typeof v === "string") return v.trim() || void 0;
  if (Array.isArray(v)) {
    const parts = v.map((p) => isObj(p) ? str(p.text) ?? str(p.content) : str(p)).filter(Boolean);
    if (parts.length) return parts.join("\n");
    return void 0;
  }
  if (isObj(v)) {
    if (isObj(v.kwargs)) return messageText(v.kwargs.content) ?? messageText(v.kwargs);
    return messageText(v.content) ?? str(v.text) ?? str(v.value);
  }
  return void 0;
}
function lastMessage(v) {
  let list = v;
  if (Array.isArray(list) && list.length === 1 && Array.isArray(list[0])) list = list[0];
  if (!Array.isArray(list) || list.length === 0) return void 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const t = messageText(list[i]);
    if (t) return t;
  }
  return void 0;
}
function pickOutput(o) {
  const out = o.outputs ?? o.output;
  if (str(out)) return str(out);
  if (isObj(out)) {
    const gens = out.generations;
    if (Array.isArray(gens)) {
      const flat = Array.isArray(gens[0]) ? gens[0] : gens;
      const first = flat[0];
      if (isObj(first)) {
        const t = str(first.text) ?? messageText(first.message) ?? messageText(first);
        if (t) return t;
      }
    }
    return str(out.output) ?? messageText(out.output) ?? str(out.answer) ?? str(out.result) ?? str(out.text) ?? str(out.content) ?? messageText(out.content) ?? lastMessage(out.messages);
  }
  return void 0;
}
function pickInput(o) {
  const inp = o.inputs ?? o.input;
  if (str(inp)) return str(inp);
  if (isObj(inp)) {
    return str(inp.input) ?? str(inp.question) ?? str(inp.query) ?? str(inp.prompt) ?? str(inp.text) ?? lastMessage(inp.messages) ?? lastMessage(inp.chat_history);
  }
  return void 0;
}
function documentsFrom(v) {
  const out = [];
  const push = (d) => {
    if (typeof d === "string" && d.trim()) out.push(d);
    else if (isObj(d)) {
      const t = str(d.page_content) ?? str(d.pageContent) ?? str(d.text) ?? str(d.content) ?? str(d.chunk) ?? str(d.body);
      if (t) out.push(t);
    }
  };
  if (Array.isArray(v)) v.forEach(push);
  else if (isObj(v) && Array.isArray(v.documents)) v.documents.forEach(push);
  return out;
}
var RETRIEVAL_NAME = /retriev|search|vector|embed|lookup|knowledge|rag|context|documents?/i;
function pickSources(o) {
  const found = [];
  const out = o.outputs ?? o.output;
  if (isObj(out)) {
    found.push(...documentsFrom(out.documents ?? out.context ?? out.source_documents ?? out.sourceDocuments));
  }
  const inp = o.inputs ?? o.input;
  if (isObj(inp)) {
    found.push(...documentsFrom(inp.context ?? inp.documents ?? inp.retrieved ?? inp.chunks));
  }
  for (const key of ["child_runs", "childRuns", "children", "observations", "spans", "steps"]) {
    const kids = o[key];
    if (!Array.isArray(kids)) continue;
    for (const kid of kids) {
      if (!isObj(kid)) continue;
      const name = `${str(kid.run_type) ?? ""} ${str(kid.type) ?? ""} ${str(kid.name) ?? ""}`;
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
function extractTrace(obj) {
  const looksNested = isObj(obj.inputs) || isObj(obj.outputs) || isObj(obj.input) || isObj(obj.output) || Array.isArray(obj.observations) || Array.isArray(obj.child_runs) || Array.isArray(obj.childRuns);
  if (!looksNested) return {};
  const out = {
    input: pickInput(obj),
    output: pickOutput(obj),
    sources: pickSources(obj),
    id: str(obj.id) ?? str(obj.trace_id) ?? str(obj.traceId) ?? str(obj.run_id),
    at: str(obj.start_time) ?? str(obj.startTime) ?? str(obj.timestamp) ?? str(obj.created_at)
  };
  return out;
}

// src/aiwork/record.ts
var INPUT_KEYS = ["input", "prompt", "question", "query", "task", "instruction", "request"];
var OUTPUT_KEYS = ["output", "response", "answer", "completion", "result", "generation", "text"];
var SOURCE_KEYS = ["sources", "context", "documents", "docs", "retrieved", "chunks", "evidence", "reference", "references", "ground_truth_context"];
var ID_KEYS = ["id", "task_id", "trace_id", "run_id", "request_id", "uuid"];
var TIME_KEYS = ["at", "timestamp", "time", "created_at", "started_at"];
function firstString(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = v;
      for (const ik of ["text", "content", "value", "message"]) {
        const iv = inner[ik];
        if (typeof iv === "string" && iv.trim().length > 0) return iv;
      }
    }
  }
  return void 0;
}
function collectSources(obj) {
  const out = [];
  for (const k of SOURCE_KEYS) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) out.push(v);
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.trim()) out.push(item);
        else if (item && typeof item === "object") {
          const rec = item;
          for (const ik of ["text", "content", "page_content", "body", "chunk", "value"]) {
            const iv = rec[ik];
            if (typeof iv === "string" && iv.trim()) {
              out.push(iv);
              break;
            }
          }
        }
      }
    }
  }
  return out;
}
function parseTaskRecords(text) {
  const records = [];
  const issues = [];
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      arr.forEach((item, i) => {
        const r = toRecord(item, i + 1, issues);
        if (r) records.push(r);
      });
      return { records, issues };
    } catch (err) {
      return { records, issues: [{ line: 1, reason: `The file starts with "[" but is not valid JSON: ${String(err)}` }] };
    }
  }
  if (!trimmed.startsWith("{") && looksLikeCsvHeader(trimmed)) {
    return parseCsvRecords(trimmed);
  }
  const lines = trimmed.split("\n");
  lines.forEach((line, i) => {
    const l = line.trim();
    if (!l) return;
    let parsed;
    try {
      parsed = JSON.parse(l);
    } catch {
      issues.push({ line: i + 1, reason: "Not valid JSON." });
      return;
    }
    const r = toRecord(parsed, i + 1, issues);
    if (r) records.push(r);
  });
  return { records, issues };
}
function readCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}
var ALL_KEYS = /* @__PURE__ */ new Set([...INPUT_KEYS, ...OUTPUT_KEYS, ...SOURCE_KEYS, ...ID_KEYS, ...TIME_KEYS]);
function looksLikeCsvHeader(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  if (!firstLine.includes(",")) return false;
  const cols = readCsv(firstLine)[0] ?? [];
  return cols.some((c) => ALL_KEYS.has(c.trim().toLowerCase())) && cols.some((c) => OUTPUT_KEYS.includes(c.trim().toLowerCase()));
}
function parseCsvRecords(text) {
  const rows = readCsv(text);
  const issues = [];
  const records = [];
  const header = (rows[0] ?? []).map((h) => h.trim());
  rows.slice(1).forEach((cells, i) => {
    const obj = {};
    header.forEach((h, c) => {
      const v = cells[c];
      if (v === void 0 || v === "") return;
      if (SOURCE_KEYS.includes(h.toLowerCase())) {
        try {
          obj[h] = JSON.parse(v);
          return;
        } catch {
          obj[h] = v.includes("|") ? v.split("|") : v.includes(";") ? v.split(";") : [v];
          return;
        }
      }
      obj[h] = v;
    });
    const r = toRecord(obj, i + 2, issues);
    if (r) records.push(r);
  });
  return { records, issues };
}
function toRecord(item, line, issues) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    issues.push({ line, reason: "Not an object." });
    return void 0;
  }
  const obj = item;
  const trace = extractTrace(obj);
  const output = firstString(obj, OUTPUT_KEYS) ?? trace.output;
  if (!output) {
    issues.push({
      line,
      reason: `No output found. Looked for: ${OUTPUT_KEYS.join(", ")} (and LangSmith/Langfuse trace shapes). Without an answer there is nothing to check.`
    });
    return void 0;
  }
  const generic = collectSources(obj);
  const input = firstString(obj, INPUT_KEYS) ?? trace.input ?? "";
  const sources = generic.length > 0 ? generic : trace.sources ?? [];
  const id = firstString(obj, ID_KEYS) ?? trace.id ?? `line-${line}`;
  const at = firstString(obj, TIME_KEYS) ?? trace.at;
  return { id, at, input, sources, output, meta: obj };
}
function groundingSourcesFor(record) {
  if (record.sources.length > 0) return { sources: record.sources, basis: "sources" };
  if (record.input.trim().length > 0) {
    return {
      sources: [record.input],
      basis: "prompt",
      note: "No retrieved sources were recorded, so the answer could only be checked against the prompt. Anything absent from the prompt is reported as unproven, not as a fabrication."
    };
  }
  return { sources: [], basis: "none", note: "Neither sources nor a prompt were recorded, so nothing could be checked." };
}

// src/aiwork/check.ts
import { createHash } from "node:crypto";

// src/verify/grounding.ts
var NOT_NAMES = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "then",
  "this",
  "that",
  "these",
  "those",
  "i",
  "we",
  "you",
  "he",
  "she",
  "it",
  "they",
  "there",
  "here",
  "his",
  "her",
  "their",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "yes",
  "no",
  "please",
  "thanks",
  "thank",
  "hello",
  "hi",
  "dear",
  "regards",
  "sincerely",
  "note",
  "summary",
  "total",
  "subtotal",
  "overview",
  "introduction",
  "conclusion",
  "based",
  "according",
  "however",
  "therefore",
  "additionally",
  "furthermore",
  "finally",
  "unfortunately",
  "sorry",
  "as",
  "in",
  "on",
  "at",
  "for",
  "to",
  "from",
  "with",
  "by",
  "your",
  "our",
  "my",
  "all",
  "each",
  "every",
  "some",
  "any",
  "no",
  "not"
]);
var TRIVIAL_NUMBER_MAX = 10;
function normaliseNumber(s) {
  const cleaned = s.replace(/[,\s]/g, "");
  const n = Number(cleaned.replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return cleaned.toLowerCase();
  return String(n);
}
function normaliseText(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}
var PATTERNS = [
  { kind: "email", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: "url", re: /\bhttps?:\/\/[^\s"'<>)\]]+/g },
  { kind: "money", re: /(?:[$£€¥]\s?\d[\d,]*(?:\.\d+)?)|(?:\d[\d,]*(?:\.\d+)?\s?(?:USD|GBP|EUR|INR))\b/g },
  { kind: "date", re: /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  // Identifiers: ORD-1042, INV-2026-0412, SKU12345. Every dashed segment has to
  // be consumed in one match, or the tail is left behind and reported as a
  // stray number, which points a reviewer at "9999" instead of at the invented
  // invoice number it came from.
  { kind: "identifier", re: /\b[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+\b|\b[A-Z]{2,}\d{3,}\b/g },
  { kind: "number", re: /\b\d[\d,]*(?:\.\d+)?\b/g }
];
var QUOTE_RE = /["“”]([^"“”\n]{12,200})["“”]/g;
function dateCandidates(raw) {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return [`${iso[1]}-${iso[2]}-${iso[3]}`];
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += y < 70 ? 2e3 : 1900;
    const pad = (n) => String(n).padStart(2, "0");
    const out = [];
    if (a >= 1 && a <= 31 && b >= 1 && b <= 12) out.push(`${y}-${pad(b)}-${pad(a)}`);
    if (b >= 1 && b <= 31 && a >= 1 && a <= 12) out.push(`${y}-${pad(a)}-${pad(b)}`);
    return out.length > 0 ? out : [raw.toLowerCase()];
  }
  return [raw.toLowerCase()];
}
var NUM_WORD = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};
var NUM_SCALE = { hundred: 100, thousand: 1e3, million: 1e6, billion: 1e9 };
var SPELLED_RE = new RegExp(
  String.raw`\b(?:(?:${Object.keys(NUM_WORD).join("|")}|${Object.keys(NUM_SCALE).join("|")}|and|a)[\s-]+)*(?:${Object.keys(
    NUM_SCALE
  ).join("|")})\b`,
  "gi"
);
function spelledValue(span) {
  const words = span.toLowerCase().split(/[\s-]+/).filter((w) => w && w !== "and");
  let result = 0;
  let current = 0;
  let sawAny = false;
  for (const w of words) {
    if (w === "a") {
      current = current || 1;
      continue;
    }
    if (w in NUM_WORD) {
      current += NUM_WORD[w];
      sawAny = true;
    } else if (w in NUM_SCALE) {
      const scale = NUM_SCALE[w];
      sawAny = true;
      if (scale >= 1e3) {
        result += (current || 1) * scale;
        current = 0;
      } else {
        current = (current || 1) * scale;
      }
    } else {
      return null;
    }
  }
  return sawAny ? result + current : null;
}
function spelledNumbers(text) {
  const out = [];
  for (const m of text.matchAll(SPELLED_RE)) {
    const raw = m[0].trim();
    const value = spelledValue(raw);
    if (value !== null && value > TRIVIAL_NUMBER_MAX) out.push({ raw, value });
  }
  return out;
}
function extractAtoms(text) {
  if (!text) return [];
  let remaining = text;
  const atoms = [];
  const seen = /* @__PURE__ */ new Set();
  const trimTrailingPunctuation = (s) => s.replace(/[.,;:!?)\]}'"»]+$/, "");
  const push = (kind, rawIn, keyIn) => {
    let raw = rawIn;
    let key = keyIn;
    if (kind === "url" || kind === "email" || kind === "identifier") {
      raw = trimTrailingPunctuation(raw);
      key = trimTrailingPunctuation(key);
    }
    if (!raw) return;
    const id = `${kind}|${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    atoms.push({ kind, text: raw, key });
  };
  for (const m of text.matchAll(QUOTE_RE)) {
    const raw = m[1] ?? "";
    if (raw) push("quote", raw, normaliseText(raw));
  }
  for (const { raw, value } of spelledNumbers(text)) {
    push("number", raw, String(value));
    remaining = remaining.split(raw).join(" ");
  }
  for (const { kind, re } of PATTERNS) {
    const found = [];
    for (const m of remaining.matchAll(new RegExp(re.source, re.flags))) {
      const raw = m[0];
      if (!raw) continue;
      found.push(m[0]);
      if (kind === "number" || kind === "money") {
        const n = Number(normaliseNumber(raw));
        if (kind === "number" && Number.isFinite(n) && Math.abs(n) <= TRIVIAL_NUMBER_MAX && !raw.includes(".")) continue;
        push(kind, raw, normaliseNumber(raw));
      } else {
        push(kind, raw, normaliseText(raw));
      }
    }
    for (const f of found) remaining = remaining.split(f).join(" ");
  }
  for (const m of remaining.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,3})\b/g)) {
    const raw = m[1] ?? "";
    const words = raw.split(/\s+/);
    if (words.length === 1) {
      const w = words[0].toLowerCase();
      if (NOT_NAMES.has(w) || w.length < 4) continue;
      const before = remaining.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
      if (/(^|[.!?:;•\-])\s*$/.test(before) || /\n\s*$/.test(before)) continue;
    } else if (words.every((w) => NOT_NAMES.has(w.toLowerCase()))) {
      continue;
    }
    push("name", raw, normaliseText(raw));
  }
  return atoms;
}
function isPresent(atom, sourceRaw, sourceNormalised, sourceNumbers, sourceDates) {
  switch (atom.kind) {
    case "number":
    case "money":
      return sourceNumbers.has(atom.key);
    case "date": {
      if (sourceNormalised.includes(atom.key)) return true;
      return dateCandidates(atom.text).some((d) => sourceDates.has(d));
    }
    case "quote": {
      const words = atom.key.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
      const src = sourceNormalised.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
      return src.includes(words);
    }
    default:
      return sourceNormalised.includes(atom.key) || sourceRaw.includes(atom.text);
  }
}
function describe(atom) {
  switch (atom.kind) {
    case "money":
      return "a monetary amount that appears nowhere in the material the model was given";
    case "number":
      return "a figure that does not appear in the source";
    case "date":
      return "a date that does not appear in the source";
    case "email":
      return "an email address that does not appear in the source, which means it was either invented or carried in from somewhere else";
    case "url":
      return "a link that does not appear in the source, and invented links are among the most confidently produced things a model does";
    case "identifier":
      return "an identifier that does not appear in the source, so anything downstream keyed on it will not resolve";
    case "quote":
      return "a passage presented as a quotation that is not in the source";
    case "name":
      return "a proper name that does not appear in the source";
  }
}
function checkGrounding(output, sources, opts = {}) {
  const kinds = new Set(opts.kinds ?? ["money", "identifier", "email", "url", "date", "quote", "number", "name"]);
  const minAtoms = opts.minAtoms ?? 1;
  const sourceRaw = sources.join("\n");
  if (sourceRaw.trim().length === 0) {
    return {
      checked: 0,
      ungrounded: [],
      inconclusive: true,
      reason: "No source material was captured for this task, so there is nothing to check the answer against. That is a gap in the evidence rather than a clean result."
    };
  }
  const sourceNormalised = normaliseText(sourceRaw);
  const sourceNumbers = /* @__PURE__ */ new Set();
  for (const m of sourceRaw.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)) sourceNumbers.add(normaliseNumber(m[0]));
  for (const { value } of spelledNumbers(sourceRaw)) sourceNumbers.add(String(value));
  const sourceDates = /* @__PURE__ */ new Set();
  for (const m of sourceRaw.matchAll(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g)) {
    for (const d of dateCandidates(m[0])) sourceDates.add(d);
  }
  const atoms = extractAtoms(output).filter((a) => kinds.has(a.kind));
  if (atoms.length < minAtoms) {
    return {
      checked: atoms.length,
      ungrounded: [],
      inconclusive: true,
      reason: `The answer contains ${atoms.length} checkable fact(s), which is too few to conclude anything. Groundedness is a claim about specifics, and prose without specifics cannot be checked this way.`
    };
  }
  const ungrounded = [];
  for (const atom of atoms) {
    if (!isPresent(atom, sourceRaw, sourceNormalised, sourceNumbers, sourceDates)) {
      ungrounded.push({ ...atom, why: describe(atom) });
    }
  }
  return { checked: atoms.length, ungrounded, inconclusive: false };
}

// src/verify/assert.ts
var TRUNCATION_BOUNDARIES = /* @__PURE__ */ new Set([100, 128, 255, 256, 500, 512, 1e3, 1024, 2e3, 2048, 4e3, 4096, 8e3, 8192]);
var REFUSAL_PATTERNS = [
  /\bI'?m sorry,? but\b/i,
  /\bI (?:cannot|can'?t|am unable to|won'?t be able to)\b/i,
  /\bAs an AI(?: language model)?\b/i,
  /\bI (?:do not|don'?t) have (?:access|the ability)\b/i,
  /\bI'?m not able to (?:assist|help|provide)\b/i,
  /\bUnfortunately,? I\b/i
];
var TEMPLATE_PATTERNS = [
  /\{\{[^{}]*\}\}/,
  // handlebars / n8n expressions that never rendered
  /\{%[^%]*%\}/,
  // jinja / liquid tags
  /\$\{[^{}]*\}/,
  // template literals that arrived as text
  /<%[^%]*%>/
  // ejs / erb
];
var ERROR_TEXT_PATTERNS = [
  /\[object Object\]/,
  /^\s*(?:error|exception)\s*[:!]/i,
  /\bTraceback \(most recent call last\)/,
  /\b(?:ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|EAI_AGAIN)\b/,
  /\bRequest failed with status code \d{3}\b/,
  /\bNaN\b/
];
function matchDegenerate(value, pattern) {
  if (typeof value !== "string") {
    return false;
  }
  switch (pattern) {
    case "empty-string":
      return value.trim().length === 0;
    case "unrendered-template":
      return TEMPLATE_PATTERNS.some((r) => r.test(value));
    case "model-refusal":
      return REFUSAL_PATTERNS.some((r) => r.test(value));
    case "error-text-in-value":
      return ERROR_TEXT_PATTERNS.some((r) => r.test(value));
    case "null-literal":
      return /^\s*(?:null|undefined|nil|None)\s*$/.test(value);
    case "truncation-marker":
      return /(?:\.{3}|…)$/.test(value) && TRUNCATION_BOUNDARIES.has(value.length);
  }
}
function describeDegenerate(pattern) {
  switch (pattern) {
    case "empty-string":
      return "was empty";
    case "unrendered-template":
      return "still contains an unrendered template expression, so a value was never substituted in";
    case "model-refusal":
      return "contains a model refusal, so the AI step declined and the workflow carried the refusal downstream as if it were content";
    case "error-text-in-value":
      return "contains error text where a value should be";
    case "null-literal":
      return 'contains the text "null" rather than an absent value, which usually means a missing field was stringified somewhere upstream';
    case "truncation-marker":
      return "ends in an ellipsis at a common field-width boundary, which suggests it was cut off in transit rather than written that way";
  }
}

// src/verify/consistency.ts
var MONEY = String.raw`(?:[$£€¥]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*\.\d{2})(?!\s?%|\d)`;
function amount(s) {
  return Number(s.replace(/[^0-9.]/g, ""));
}
function near(a, b) {
  return Math.abs(a - b) <= 0.02 + Math.max(Math.abs(a), Math.abs(b)) * 1e-6;
}
var SUBTOTAL_LABELS = ["subtotal", "sub-total", "sub total", "net amount", "net total", "goods total"];
var TAX_LABELS = ["vat", "tax", "gst", "sales tax"];
var TOTAL_LABELS = ["grand total", "total due", "total amount due", "amount due", "total payable", "amount payable", "balance due", "total", "balance", "outstanding balance"];
var ADJUSTMENT_LABELS = ["shipping", "delivery", "postage", "discount", "credit", "handling", "fee", "surcharge", "adjustment"];
function labelPattern(label) {
  const gap = String.raw`(?:[^\d$£€¥\n]|\d{1,3}(?:\.\d+)?\s?%){0,20}?`;
  return `\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b${gap}(${MONEY})`;
}
function labelled(text, labels) {
  for (const label of labels) {
    const m = new RegExp(labelPattern(label), "i").exec(text);
    if (m && m[1]) return { value: amount(m[1]), raw: `${label} ${m[1].trim()}` };
  }
  return void 0;
}
function allLabelled(text, labels) {
  const out = [];
  for (const label of labels) {
    for (const m of text.matchAll(new RegExp(labelPattern(label), "gi"))) {
      if (m[1]) out.push({ value: amount(m[1]), raw: `${label} ${m[1].trim()}` });
    }
  }
  return out;
}
function checkArithmetic(text, out) {
  const sub = labelled(text, SUBTOTAL_LABELS);
  const tax = labelled(text, TAX_LABELS);
  const total = labelled(text, TOTAL_LABELS);
  if (!sub || !total) return;
  const hasAdjustment = ADJUSTMENT_LABELS.some((l) => new RegExp(`\\b${l}\\b`, "i").test(text));
  if (hasAdjustment) return;
  const expected = sub.value + (tax?.value ?? 0);
  if (!near(expected, total.value)) {
    out.push({
      kind: "arithmetic",
      summary: tax ? `The subtotal and tax do not add up to the stated total: ${sub.value.toFixed(2)} + ${tax.value.toFixed(2)} is ${expected.toFixed(2)}, not ${total.value.toFixed(2)}.` : `The subtotal does not match the stated total, and no tax or adjustment is given to bridge them: ${sub.value.toFixed(2)} against ${total.value.toFixed(2)}.`,
      evidence: [sub.raw, tax?.raw, total.raw].filter(Boolean).join("; ")
    });
  }
}
function checkRestatedValue(text, out) {
  for (const [name, labels] of [
    ["total", TOTAL_LABELS],
    ["subtotal", SUBTOTAL_LABELS],
    ["tax", TAX_LABELS]
  ]) {
    const seen = allLabelled(text, labels);
    if (seen.length < 2) continue;
    const distinct = [...new Set(seen.map((s) => s.value.toFixed(2)))];
    if (distinct.length > 1) {
      out.push({
        kind: "restated-value",
        summary: `The answer gives more than one figure for the ${name}: ${distinct.join(" and ")}.`,
        evidence: seen.map((s) => s.raw).join("; ")
      });
      return;
    }
  }
}
function checkPercentage(text, out) {
  const sub = labelled(text, SUBTOTAL_LABELS);
  const pct = /\b(\d{1,2}(?:\.\d+)?)\s?%/.exec(text);
  const tax = labelled(text, TAX_LABELS);
  if (!sub || !pct || !tax || !pct[1]) return;
  const rate = Number(pct[1]) / 100;
  const expected = sub.value * rate;
  if (Math.abs(expected - tax.value) > 0.5 + sub.value * 1e-3) {
    out.push({
      kind: "percentage",
      summary: `Tax is stated as ${pct[1]}% but the amount does not match: ${pct[1]}% of ${sub.value.toFixed(2)} is ${expected.toFixed(2)}, not ${tax.value.toFixed(2)}.`,
      evidence: `${sub.raw}; rate ${pct[1]}%; ${tax.raw}`
    });
  }
}
var ISSUE_LABELS = ["issued", "issue date", "invoice date", "order date", "dated", "created"];
var DUE_LABELS = ["due", "due date", "payment due", "pay by", "payable by"];
function isoDate(text, labels) {
  for (const label of labels) {
    const re = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b[^\\d\\n]{0,16}?(\\d{4}-\\d{2}-\\d{2})`, "i");
    const m = re.exec(text);
    if (m && m[1]) return { iso: m[1], raw: `${label} ${m[1]}` };
  }
  return void 0;
}
function checkDateOrder(text, out) {
  const issued = isoDate(text, ISSUE_LABELS);
  const due = isoDate(text, DUE_LABELS);
  if (issued && due && due.iso < issued.iso) {
    out.push({
      kind: "date-order",
      summary: `The due date is before the issue date: due ${due.iso}, issued ${issued.iso}.`,
      evidence: `${issued.raw}; ${due.raw}`
    });
  }
}
function checkConsistency(output) {
  if (!output || output.trim().length === 0) return [];
  const text = output.replace(/ /g, " ");
  const out = [];
  checkArithmetic(text, out);
  checkRestatedValue(text, out);
  checkPercentage(text, out);
  checkDateOrder(text, out);
  return out;
}

// src/verify/conformance.ts
var JSON_ASKED = /\b(?:return|reply|respond|output|format|give|provide)\b[^.]*\bjson\b|\bas json\b|\bin json\b|\bvalid json\b/i;
function stripFence(s) {
  const m = s.match(/^\s*```(?:json|json5)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (m && m[1] !== void 0) return { body: m[1].trim(), hadFence: true };
  return { body: s, hadFence: false };
}
function locateJson(s) {
  const first = s.search(/[[{]/);
  if (first === -1) return void 0;
  const open = s[first];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = first; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return { start: first, end: i + 1 };
    }
  }
  return { start: first, end: -1 };
}
function checkConformance(output, input = "") {
  const text = output.trim();
  if (text.length === 0) return [];
  const looksJson = /^[[{]/.test(text) || /```json/i.test(output) || JSON_ASKED.test(input);
  const out = [];
  if (looksJson) {
    const { body, hadFence } = stripFence(text);
    const located = locateJson(body);
    if (!located) {
      out.push({
        kind: "unparseable-json",
        summary: "The answer was expected to be JSON but contains no JSON value.",
        evidence: text.slice(0, 160)
      });
    } else if (located.end === -1) {
      out.push({
        kind: "truncated",
        summary: "The JSON opens but never closes, so the answer was cut off before it finished.",
        evidence: `...${body.slice(Math.max(0, body.length - 120))}`
      });
    } else {
      const candidate = body.slice(located.start, located.end);
      try {
        JSON.parse(candidate);
        const before = body.slice(0, located.start).trim();
        const after = body.slice(located.end).trim();
        if ((before.length > 0 || after.length > 0) && !hadFence) {
          out.push({
            kind: "json-with-surrounding-prose",
            summary: "The JSON is valid but has prose around it, so a parser expecting only JSON will reject the whole response.",
            evidence: (before || after).slice(0, 160)
          });
        }
      } catch (err) {
        out.push({
          kind: "unparseable-json",
          summary: `The answer looks like JSON but does not parse: ${String(err.message).slice(0, 100)}.`,
          evidence: candidate.slice(0, 160)
        });
      }
    }
  }
  const tableLines = text.split("\n").filter((l) => /^\s*\|.*\|\s*$/.test(l));
  if (tableLines.length >= 3) {
    const cols = tableLines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map((l) => l.split("|").slice(1, -1).length);
    const first = cols[0];
    if (first !== void 0 && cols.some((n) => n !== first)) {
      out.push({
        kind: "ragged-table",
        summary: `The table rows do not have the same number of columns (${[...new Set(cols)].join(", ")}).`,
        evidence: tableLines.slice(0, 3).join("  //  ").slice(0, 200)
      });
    }
  }
  return out;
}

// src/aiwork/check.ts
var DEGENERATE_PATTERNS = [
  "empty-string",
  "unrendered-template",
  "model-refusal",
  "error-text-in-value",
  "null-literal"
];
var DEFERRAL_PATTERNS = [
  /\b(?:please )?(?:contact|reach out to|speak to|get in touch with) (?:our |a |the )?(?:support|customer service|human|agent|representative|team)\b/i,
  /\bI(?:'| a)m (?:going to |now )?(?:transfer|escalat|hand)(?:ring|ing)? (?:you |this )?(?:over |on )?to\b/i,
  /\bescalat(?:ing|ed) (?:this |your )?(?:to|for) (?:a |the )?(?:human|agent|team|specialist)\b/i,
  /\bI (?:cannot|can't|am unable to) (?:help|assist|answer|resolve)\b/i,
  /\bthis (?:will be|has been) (?:passed|routed|forwarded) to\b/i
];
var DEFERRAL_MAX_CHARS = 400;
function looksDeferred(output) {
  const trimmed = output.trim();
  if (trimmed.length === 0 || trimmed.length > DEFERRAL_MAX_CHARS) return { deferred: false };
  for (const re of DEFERRAL_PATTERNS) {
    const m = re.exec(trimmed);
    if (m && (m.index ?? 0) < trimmed.length * 0.6) return { deferred: true, matched: m[0] };
  }
  return { deferred: false };
}
function fingerprint(s) {
  return createHash("sha256").update(s.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}
function checkBatch(records, opts = {}) {
  const duplicateThreshold = opts.duplicateThreshold ?? 3;
  const counts = /* @__PURE__ */ new Map();
  for (const r of records) {
    const fp = fingerprint(r.output);
    counts.set(fp, (counts.get(fp) ?? 0) + 1);
  }
  const results = [];
  const byKind = {
    degenerate: 0,
    ungrounded: 0,
    deferred: 0,
    duplicated: 0,
    inconsistent: 0,
    malformed: 0
  };
  for (const record of records) {
    const problems = [];
    for (const pattern of DEGENERATE_PATTERNS) {
      if (matchDegenerate(record.output, pattern)) {
        problems.push({
          kind: "degenerate",
          summary: `The answer ${describeDegenerate(pattern)}.`,
          evidence: record.output.slice(0, 300)
        });
        break;
      }
    }
    const deferral = looksDeferred(record.output);
    if (deferral.deferred) {
      problems.push({
        kind: "deferred",
        summary: "The answer hands the task back rather than doing it. This counts as a completed task in most pipelines, which is how a high resolution rate can coexist with nothing being resolved.",
        evidence: deferral.matched ?? record.output.slice(0, 200)
      });
    }
    const dupCount = counts.get(fingerprint(record.output)) ?? 0;
    if (dupCount >= duplicateThreshold && record.output.trim().length > 0) {
      problems.push({
        kind: "duplicated",
        summary: `This exact answer was produced for ${dupCount} different tasks, which usually means the pipeline stopped reading its input.`,
        evidence: record.output.slice(0, 200)
      });
    }
    for (const bad of checkConsistency(record.output)) {
      problems.push({ kind: "inconsistent", summary: bad.summary, evidence: bad.evidence });
    }
    for (const bad of checkConformance(record.output, record.input)) {
      problems.push({ kind: "malformed", summary: bad.summary, evidence: bad.evidence });
    }
    let inconclusive2 = false;
    let inconclusiveReason;
    let atomsChecked = 0;
    if (!opts.skipGrounding) {
      const { sources, basis, note } = groundingSourcesFor(record);
      const g = checkGrounding(record.output, sources, opts);
      atomsChecked = g.checked;
      if (g.inconclusive) {
        inconclusive2 = problems.length === 0;
        inconclusiveReason = note ? `${g.reason} ${note}` : g.reason;
      } else if (basis === "prompt" && g.ungrounded.length > 0) {
        inconclusive2 = problems.length === 0;
        inconclusiveReason = `${g.ungrounded.length} fact(s) in the answer could not be traced. ${note}`;
      } else {
        for (const u of g.ungrounded) {
          problems.push({
            kind: "ungrounded",
            summary: `"${u.text}" is ${u.why}.`,
            evidence: u.text
          });
        }
      }
    }
    for (const p of problems) byKind[p.kind] += 1;
    results.push({
      id: record.id,
      at: record.at,
      problems,
      inconclusive: inconclusive2,
      inconclusiveReason,
      atomsChecked
    });
  }
  const problematic = results.filter((r) => r.problems.length > 0).length;
  const inconclusiveCount = results.filter((r) => r.inconclusive).length;
  const clean = results.length - problematic - inconclusiveCount;
  const pct = results.length > 0 ? Math.round(problematic / results.length * 100) : 0;
  const headline = problematic === 0 ? `${results.length} answers checked, none carrying a problem this can detect.` : `${problematic} of ${results.length} answers (${pct}%) contain something the pipeline reported as a success.`;
  return {
    results,
    summary: {
      total: results.length,
      clean,
      problematic,
      inconclusive: inconclusiveCount,
      byKind,
      headline,
      caveat: "This checks whether an answer is empty, refused, unrendered, deferred, duplicated, self-contradictory, malformed when it should be structured, or contains specifics absent from its own source material. It does not check whether the answer is wise, complete or appropriate, and a clean result is not a claim that the work was good. No model was asked to grade another model."
    }
  };
}

// src/aiwork/demo.ts
var INVOICE = (n, total, vat, due) => `
Invoice INV-2026-${String(400 + n).padStart(4, "0")} for Fernweh Supply Ltd
Issued 2026-08-${String(1 + n % 20).padStart(2, "0")}, due ${due}
Billing contact: accounts@fernweh.example
Subtotal ${total}
VAT ${vat}
Portal: https://billing.fernweh.example/inv/2026-${String(400 + n).padStart(4, "0")}
`;
function demoTasks() {
  const out = [];
  for (let i = 0; i < 20; i++) {
    const total = `\xA3${(500 + i * 13).toFixed(2)}`;
    const vat = `\xA3${((500 + i * 13) * 0.2).toFixed(2)}`;
    const due = `2026-09-${String(1 + i % 25).padStart(2, "0")}`;
    const source = INVOICE(i, total, vat, due);
    const id = `task-${String(i + 1).padStart(3, "0")}`;
    const at = new Date(Date.UTC(2026, 8, 1, 9 + i % 8, 0, 0)).toISOString();
    const input = "The customer is asking what they owe and when it is due. Answer using the invoice provided.";
    let output;
    if (i === 3) {
      output = `Your outstanding balance is \xA3742.60, including VAT of \xA3123.77, and it is due on 2026-09-30. If you need a copy, email finance@fernweh.example.`;
    } else if (i === 7) {
      output = `Hi {{ customer.first_name }}, your balance of {{ invoice.total }} is due on {{ invoice.due_date }}.`;
    } else if (i === 11) {
      output = `I'm sorry, but I cannot access billing information for this account.`;
    } else if (i === 14) {
      output = `Thanks for getting in touch. Please contact our support team and they will be able to help you with this.`;
    } else if (i === 16 || i === 17 || i === 18) {
      output = `Your invoice is available in the billing portal. Please log in to view the current balance and due date.`;
    } else {
      output = `Your subtotal is ${total} with VAT of ${vat}, due on ${due}. The invoice is INV-2026-${String(400 + i).padStart(4, "0")} and you can view it at https://billing.fernweh.example/inv/2026-${String(400 + i).padStart(4, "0")}.`;
    }
    out.push({ id, at, input, sources: [source], output });
  }
  return out;
}

// src/eval/score.ts
function norm(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim().replace(/[.,;:!?)\]}'"]+$/, "");
}
function ratio(n, d) {
  return d === 0 ? 1 : n / d;
}
function scoreBatch(batch) {
  const byId = new Map(batch.labels.map((l) => [l.id, l]));
  const { results } = checkBatch(batch.records, batch.checkOptions);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let incOk = 0;
  let incBad = 0;
  let knownGaps = 0;
  const byKindRecall = {};
  let atomTp = 0;
  let atomFp = 0;
  let atomFn = 0;
  const disagreements = [];
  for (const r of results) {
    const label = byId.get(r.id);
    if (!label) continue;
    const got = r.problems.length > 0 ? "problem" : r.inconclusive ? "inconclusive" : "clean";
    const gotKinds = new Set(r.problems.map((p) => p.kind));
    const gotAtoms = new Set(r.problems.filter((p) => p.kind === "ungrounded").map((p) => norm(p.evidence)));
    if (label.verdict === "clean") {
      if (got === "problem") {
        if (label.xfail) knownGaps += 1;
        else fp += 1;
        disagreements.push({
          id: r.id,
          expected: "clean",
          got,
          kind: "false-positive",
          detail: `flagged as ${[...gotKinds].join(", ")}: ${r.problems.map((p) => p.summary).join(" | ")}`,
          knownGap: label.xfail
        });
      } else {
        tn += 1;
        if (got === "inconclusive") {
          disagreements.push({
            id: r.id,
            expected: "clean",
            got,
            kind: "inconclusive-mismatch",
            detail: r.inconclusiveReason ?? "no checkable atoms"
          });
        }
      }
    } else if (label.verdict === "problem") {
      if (got === "problem") {
        tp += 1;
        for (const k of label.kinds ?? []) {
          byKindRecall[k] ??= { expected: 0, caught: 0 };
          byKindRecall[k].expected += 1;
          if (gotKinds.has(k)) byKindRecall[k].caught += 1;
          else {
            disagreements.push({
              id: r.id,
              expected: "problem",
              got,
              kind: "wrong-reason",
              detail: `expected a ${k} finding, got ${[...gotKinds].join(", ") || "none"}`
            });
          }
        }
        if (label.atoms && label.atoms.length > 0) {
          const want = new Set(label.atoms.map(norm));
          for (const a of want) gotAtoms.has(a) ? atomTp++ : atomFn++;
          for (const a of gotAtoms) if (!want.has(a)) atomFp++;
          const missed = [...want].filter((a) => !gotAtoms.has(a));
          const extra = [...gotAtoms].filter((a) => !want.has(a));
          if (missed.length || extra.length) {
            disagreements.push({
              id: r.id,
              expected: "problem",
              got,
              kind: "atom-mismatch",
              detail: `${missed.length ? `missed [${missed.join(", ")}]` : ""}${missed.length && extra.length ? "; " : ""}${extra.length ? `also flagged [${extra.join(", ")}]` : ""}`
            });
          }
        }
      } else {
        if (label.xfail) knownGaps += 1;
        else fn += 1;
        for (const k of label.kinds ?? []) {
          byKindRecall[k] ??= { expected: 0, caught: 0 };
          if (!label.xfail) byKindRecall[k].expected += 1;
        }
        disagreements.push({
          id: r.id,
          expected: "problem",
          got,
          kind: "missed-problem",
          detail: label.note ? `${label.note}` : `expected ${[...label.kinds ?? []].join(", ") || "a problem"}`,
          knownGap: label.xfail
        });
      }
    } else {
      if (got === "inconclusive") incOk += 1;
      else {
        if (label.xfail) knownGaps += 1;
        else incBad += 1;
        disagreements.push({
          id: r.id,
          expected: "inconclusive",
          got,
          kind: "inconclusive-mismatch",
          detail: got === "problem" ? r.problems.map((p) => p.summary).join(" | ") : "reached a clean verdict on too little material",
          knownGap: label.xfail
        });
      }
    }
  }
  const cleanLabelled = batch.labels.filter((l) => l.verdict === "clean").length;
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return {
    batch: batch.name,
    synthetic: batch.synthetic,
    tasks: results.length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    trueNegatives: tn,
    inconclusiveCorrect: incOk,
    inconclusiveMismatch: incBad,
    knownGaps,
    precision,
    recall,
    f1: ratio(2 * precision * recall, precision + recall),
    falsePositiveRate: ratio(fp, cleanLabelled),
    byKindRecall,
    atomPrecision: ratio(atomTp, atomTp + atomFp),
    atomRecall: ratio(atomTp, atomTp + atomFn),
    disagreements
  };
}
var DEFAULT_GATE = {
  minPrecision: 0.95,
  minRecall: 0.85,
  maxFalsePositives: 0
};
function gate(boards, t = DEFAULT_GATE) {
  const failures = [];
  let fp = 0;
  let tp = 0;
  let fn = 0;
  for (const b of boards) {
    fp += b.falsePositives;
    tp += b.truePositives;
    fn += b.falseNegatives;
    if (b.falsePositives > 0) {
      failures.push(`${b.batch}: ${b.falsePositives} faithful answer(s) flagged as a problem`);
    }
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  if (fp > t.maxFalsePositives) failures.push(`total false positives ${fp} exceeds ${t.maxFalsePositives}`);
  if (precision < t.minPrecision) failures.push(`precision ${precision.toFixed(3)} below ${t.minPrecision}`);
  if (recall < t.minRecall) failures.push(`recall ${recall.toFixed(3)} below ${t.minRecall}`);
  return { ok: failures.length === 0, failures };
}

// src/eval/corpus.ts
var billingLabels = [
  { id: "task-004", verdict: "problem", kinds: ["ungrounded"], atoms: ["\xA3742.60", "\xA3123.77", "2026-09-30", "finance@fernweh.example"], note: "every figure and the contact are invented" },
  { id: "task-008", verdict: "problem", kinds: ["degenerate"], note: "the template placeholders never rendered" },
  { id: "task-012", verdict: "problem", kinds: ["degenerate"], note: "a refusal carried downstream as content" },
  { id: "task-015", verdict: "problem", kinds: ["deferred"], note: "handed back to a human, booked as resolved" },
  { id: "task-017", verdict: "problem", kinds: ["duplicated"] },
  { id: "task-018", verdict: "problem", kinds: ["duplicated"] },
  { id: "task-019", verdict: "problem", kinds: ["duplicated"] },
  ...["001", "002", "003", "005", "006", "007", "009", "010", "011", "013", "014", "016", "020"].map(
    (n) => ({ id: `task-${n}`, verdict: "clean" })
  )
];
var faithful = [
  {
    id: "fa-01-trailing-period",
    source: "Invoice INV-5501 for Acme Ltd. Balance 420.00 GBP due 2026-10-15. Pay at https://pay.acme.example/i/5501",
    output: "Your balance is \xA3420.00, due on 2026-10-15. Pay at https://pay.acme.example/i/5501.",
    label: { id: "fa-01-trailing-period", verdict: "clean", note: "the full stop after the URL is punctuation, not part of the link" }
  },
  {
    id: "fa-02-parens-and-grouping",
    source: "Statement for Bluebird Travel. Amount outstanding: 1,240.50 GBP. Reference ORD-2291. Portal https://portal.bluebird.example/s/2291",
    output: "Bluebird Travel has \xA31,240.50 outstanding (reference ORD-2291). See the portal: https://portal.bluebird.example/s/2291)",
    label: { id: "fa-02-parens-and-grouping", verdict: "clean", note: "thousands separator and a trailing bracket" }
  },
  {
    id: "fa-03-reformatted-date",
    source: "Invoice for Carter & Sons, due 2026-11-03. Total 880.00 GBP.",
    output: "The total is \xA3880.00 and it is due on 03/11/2026.",
    label: { id: "fa-03-reformatted-date", verdict: "clean", note: "day-first date that resolves to the same day as the ISO date in the source" }
  },
  {
    id: "fa-04-number-reused",
    source: "Order placed 2026-09-02. Items: 3. Price 3.00 GBP each. Grand total 9.00 GBP. Customer ref 4471.",
    output: "Your order total is \xA39.00, that is 3 items at \xA33.00 each. Reference 4471.",
    label: { id: "fa-04-number-reused", verdict: "clean", note: "small figures that genuinely appear, plus a reference number" }
  },
  {
    id: "fa-05-requoted",
    source: "Our policy: refunds are issued within 14 days of the return being received.",
    output: 'The policy states "refunds are issued within 14 days" of us receiving your return.',
    label: { id: "fa-05-requoted", verdict: "clean", note: "a real quotation, cut short, with the following clause paraphrased" }
  },
  {
    id: "fa-06-name-at-sentence-start",
    source: "Contact: Priya Nair, accounts@nimbus.example. Nimbus Freight Co, invoice NIM-8842.",
    output: "Priya Nair is your billing contact. You can reach Priya at accounts@nimbus.example. Nimbus Freight Co issued invoice NIM-8842.",
    label: { id: "fa-06-name-at-sentence-start", verdict: "clean", note: "a real name that happens to open a sentence" }
  },
  {
    id: "fa-07-percent-and-grouping",
    source: "Interest accrues at 4.5% on the outstanding 12,500.00 GBP.",
    output: "Interest is 4.5% on the \xA312,500.00 outstanding.",
    label: { id: "fa-07-percent-and-grouping", verdict: "clean" }
  },
  {
    id: "fa-08-identifier-shapes",
    source: "Ticket #INC0004521 relates to shipment SHP-2026-0088.",
    output: "This is tracked under INC0004521 and concerns shipment SHP-2026-0088.",
    label: { id: "fa-08-identifier-shapes", verdict: "clean" }
  },
  {
    id: "fa-09-deferral-as-footnote",
    source: "Balance 615.00 GBP due 2026-10-20. Portal https://b.example/9. Escalations: support@b.example.",
    output: "Your balance is \xA3615.00, due on 2026-10-20. You can pay through the portal at https://b.example/9. If the payment does not go through, please contact our support team and they will sort it out.",
    label: { id: "fa-09-deferral-as-footnote", verdict: "clean", note: "a complete answer with a support line at the end is not a deferral" }
  },
  {
    id: "fa-10-currency-code-form",
    source: "Amount due: USD 1,999.00. Account AC-77120.",
    output: "The amount due is $1,999.00 on account AC-77120.",
    label: { id: "fa-10-currency-code-form", verdict: "clean", note: "currency named as a code in the source and a symbol in the answer" }
  },
  {
    id: "fa-11-spelled-number",
    source: "The retainer is 2,000.00 GBP a month.",
    output: "The retainer is two thousand pounds a month.",
    label: { id: "fa-11-spelled-number", verdict: "clean", note: "a figure written as words is the same figure" }
  }
];
var fabricated = [
  {
    id: "fb-01-transposed-figure",
    source: "Invoice INV-5501 for Acme Ltd. Subtotal 539.00 GBP. VAT 107.80 GBP. Due 2026-09-13.",
    output: "Your subtotal is \xA3593.00 with VAT of \xA3107.80, due on 2026-09-13.",
    label: { id: "fb-01-transposed-figure", verdict: "problem", kinds: ["ungrounded"], atoms: ["\xA3593.00"], note: "539 became 593" }
  },
  {
    id: "fb-02-plausible-invoice-number",
    source: "Invoice INV-5501 for Acme Ltd. Total 539.00 GBP due 2026-09-13.",
    output: "This relates to invoice INV-5510, total \xA3539.00, due 2026-09-13.",
    label: { id: "fb-02-plausible-invoice-number", verdict: "problem", kinds: ["ungrounded"], atoms: ["INV-5510"] }
  },
  {
    id: "fb-03-address-on-real-domain",
    source: "Billing contact for Acme Ltd: accounts@acme.example. Total 539.00 GBP.",
    output: "For a copy of the invoice, email billing@acme.example. The total is \xA3539.00.",
    label: { id: "fb-03-address-on-real-domain", verdict: "problem", kinds: ["ungrounded"], atoms: ["billing@acme.example"] }
  },
  {
    id: "fb-04-altered-quote",
    source: "Policy: returns are accepted within 30 days of delivery.",
    output: 'The policy says "returns are accepted within 60 days of delivery" so you have time.',
    label: { id: "fb-04-altered-quote", verdict: "problem", kinds: ["ungrounded"], atoms: ["returns are accepted within 60 days of delivery", "60"], note: "30 became 60 inside quotation marks" }
  },
  {
    id: "fb-05-invented-date",
    source: "Invoice total 539.00 GBP, due 2026-09-13.",
    output: "Your total is \xA3539.00, due on 2026-09-30.",
    label: { id: "fb-05-invented-date", verdict: "problem", kinds: ["ungrounded"], atoms: ["2026-09-30"] }
  },
  {
    id: "fb-06-invented-person",
    source: "For billing queries, contact the accounts team at Acme Ltd. Total 539.00 GBP.",
    output: "Please speak to Rachel Adebayo in the accounts team. Your total is \xA3539.00.",
    label: { id: "fb-06-invented-person", verdict: "problem", kinds: ["ungrounded"], atoms: ["Rachel Adebayo"] }
  },
  {
    id: "fb-07-fabricated-url",
    source: "Invoice for Acme Ltd. Total 539.00 GBP. Portal: https://portal.acme.example/9",
    output: "Download the invoice at https://portal.acme.example/invoice/9.pdf. The total is \xA3539.00.",
    label: { id: "fb-07-fabricated-url", verdict: "problem", kinds: ["ungrounded"], atoms: ["https://portal.acme.example/invoice/9.pdf"] }
  },
  {
    id: "fb-08-inflated-total",
    source: "Subtotal 400.00 GBP. VAT 80.00 GBP. Invoice INV-9001.",
    output: "The total due on invoice INV-9001 is \xA3560.00.",
    label: { id: "fb-08-inflated-total", verdict: "problem", kinds: ["ungrounded"], atoms: ["\xA3560.00"], note: "400 + 80 is not 560, and 560 is nowhere in the source" }
  },
  {
    id: "fb-09-spelled-fabrication",
    source: "The retainer is 2,000.00 GBP a month.",
    output: "The retainer is five thousand pounds a month.",
    label: { id: "fb-09-spelled-fabrication", verdict: "problem", kinds: ["ungrounded"], atoms: ["five thousand"], note: "the figure, written as words, is still invented" }
  }
];
var degenerate = [
  { id: "dd-01-empty", source: "Balance 100.00 GBP.", output: "", label: { id: "dd-01-empty", verdict: "problem", kinds: ["degenerate"] } },
  {
    id: "dd-02-template",
    source: "Customer Dana Reeve, balance 250.00 GBP due 2026-10-01.",
    output: "Hi {{ customer.first_name }}, your balance of {{ invoice.total }} is due {{ invoice.due_date }}.",
    label: { id: "dd-02-template", verdict: "problem", kinds: ["degenerate"] }
  },
  {
    id: "dd-03-short-refusal",
    source: "Balance 250.00 GBP.",
    output: "I cannot help with that request.",
    label: { id: "dd-03-short-refusal", verdict: "problem", kinds: ["deferred"] }
  },
  { id: "dd-04-null", source: "Balance 250.00 GBP.", output: "null", label: { id: "dd-04-null", verdict: "problem", kinds: ["degenerate"] } },
  {
    id: "dd-05-error-text",
    source: "Balance 250.00 GBP.",
    output: "Error: ECONNREFUSED while contacting the billing service at 10.0.0.4:5432",
    label: { id: "dd-05-error-text", verdict: "problem", kinds: ["degenerate"] }
  },
  {
    id: "dd-06-defer-to-support",
    source: "Balance 250.00 GBP due 2026-10-01.",
    output: "Please reach out to our support team for assistance with this issue.",
    label: { id: "dd-06-defer-to-support", verdict: "problem", kinds: ["deferred"] }
  }
];
var inconclusive = [
  {
    id: "ic-01-no-specifics",
    source: "The customer asked for a callback about their recent order.",
    output: "Thank you for getting in touch. A member of the team will call you back shortly to talk this through.",
    label: { id: "ic-01-no-specifics", verdict: "inconclusive", note: "nothing in the answer is checkable against a source" }
  },
  {
    id: "ic-02-no-source",
    source: "",
    output: "Your balance is \xA3412.00, due on 2026-10-09.",
    label: { id: "ic-02-no-source", verdict: "inconclusive", note: "specifics, but no material to check them against" }
  },
  {
    id: "ic-03-acknowledgement",
    source: "Customer confirmed the address change over the phone.",
    output: "Noted, thank you. That has been updated on the account.",
    label: { id: "ic-03-acknowledgement", verdict: "inconclusive" }
  }
];
var contradiction = [
  {
    id: "sc-01-arithmetic",
    source: "Subtotal 400.00 GBP, VAT 80.00 GBP, total 520.00 GBP.",
    output: "Your subtotal is \xA3400.00, VAT is \xA380.00, and the total due is \xA3520.00.",
    label: { id: "sc-01-arithmetic", verdict: "problem", kinds: ["inconsistent"], note: "400 + 80 is 480, not 520" }
  },
  {
    id: "sc-02-restated-total",
    source: "Amount outstanding varies by reading; see the statement.",
    output: "Your total is \xA3560.00. Please pay the amount due of \xA3650.00 by the end of the month.",
    label: { id: "sc-02-restated-total", verdict: "problem", kinds: ["inconsistent"], note: "two different totals in one answer" }
  },
  {
    id: "sc-03-date-order",
    source: "Invoice issued 2026-09-20. Payment terms: net 15.",
    output: "The invoice was issued on 2026-09-20 and payment is due on 2026-09-05.",
    label: { id: "sc-03-date-order", verdict: "problem", kinds: ["inconsistent"], note: "due date precedes the issue date" }
  },
  {
    id: "sc-04-percentage",
    source: "Subtotal 500.00 GBP. VAT is charged at 20%.",
    output: "The subtotal is \xA3500.00 and VAT at 20% comes to \xA3120.00.",
    label: { id: "sc-04-percentage", verdict: "problem", kinds: ["inconsistent"], note: "20% of 500 is 100, not 120" }
  },
  {
    id: "sc-05-consistent",
    source: "Subtotal 571.00 GBP, VAT 114.20 GBP, total 685.20 GBP.",
    output: "Subtotal \xA3571.00, VAT \xA3114.20, total due \xA3685.20.",
    label: { id: "sc-05-consistent", verdict: "clean", note: "the figures add up" }
  },
  {
    id: "sc-06-adjustment-line",
    source: "Subtotal 400.00 GBP. Shipping 15.00 GBP. VAT 83.00 GBP. Total 498.00 GBP.",
    output: "Subtotal is \xA3400.00, shipping \xA315.00, VAT \xA383.00, for a total of \xA3498.00.",
    label: { id: "sc-06-adjustment-line", verdict: "clean", note: "a shipping line bridges the sum, so the arithmetic check must stand down" }
  },
  {
    id: "sc-07-date-order-ok",
    source: "Invoice issued 2026-09-01, due 2026-09-30.",
    output: "It was issued on 2026-09-01 and is due on 2026-09-30.",
    label: { id: "sc-07-date-order-ok", verdict: "clean" }
  }
];
var structured = [
  {
    id: "so-01-json-in-prose",
    input: "Return the account status as valid JSON.",
    source: "items: 3, status ok",
    output: 'Certainly, here is the JSON you requested:\n{"status":"ok","count":3}',
    label: { id: "so-01-json-in-prose", verdict: "problem", kinds: ["malformed"], note: "a JSON parser will choke on the preamble" }
  },
  {
    id: "so-02-truncated",
    input: "List the orders as JSON.",
    source: "three orders",
    output: '{"orders":[{"id":1},{"id":2},{"id":',
    label: { id: "so-02-truncated", verdict: "problem", kinds: ["malformed"], note: "the object never closes" }
  },
  {
    id: "so-03-prose-when-json-asked",
    input: "Respond only with valid JSON.",
    source: "account balance is 0",
    output: "The account balance is zero, nothing is owed.",
    label: { id: "so-03-prose-when-json-asked", verdict: "problem", kinds: ["malformed"] }
  },
  {
    id: "so-04-clean-fenced",
    source: "status ok, three items",
    output: '```json\n{"status":"ok","count":3}\n```',
    label: { id: "so-04-clean-fenced", verdict: "inconclusive", note: "valid JSON, but a fenced code block has no checkable prose atoms" }
  },
  {
    id: "so-05-clean-bare",
    source: "the reference is ORD-4471 and the total is 90.00 GBP",
    output: '{"reference":"ORD-4471","total":"90.00 GBP"}',
    label: { id: "so-05-clean-bare", verdict: "clean", note: "parses, and both values trace to the source" }
  }
];
function casesToRecords(cases) {
  return {
    records: cases.map((k) => ({
      id: k.id,
      input: k.input ?? "Answer the customer using the material provided.",
      sources: k.source ? [k.source] : [],
      output: k.output
    })),
    labels: cases.map((k) => k.label)
  };
}
function builtinBatches() {
  const faith = casesToRecords(faithful);
  const fab = casesToRecords(fabricated);
  const deg = casesToRecords(degenerate);
  const inc = casesToRecords(inconclusive);
  const con = casesToRecords(contradiction);
  const str2 = casesToRecords(structured);
  return [
    { name: "billing-support", synthetic: true, records: demoTasks(), labels: billingLabels },
    { name: "faithful-adversarial", synthetic: true, records: faith.records, labels: faith.labels },
    { name: "fabrication-adversarial", synthetic: true, records: fab.records, labels: fab.labels },
    { name: "degenerate-and-deferral", synthetic: true, records: deg.records, labels: deg.labels },
    { name: "self-contradiction", synthetic: true, records: con.records, labels: con.labels },
    { name: "structured-output", synthetic: true, records: str2.records, labels: str2.labels },
    { name: "inconclusive", synthetic: true, records: inc.records, labels: inc.labels }
  ];
}

// src/ledger/chain.ts
import { createHash as createHash2 } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
var GENESIS_PREV = "0".repeat(64);
function canonical(v) {
  if (v === void 0) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const obj = v;
  const entries = Object.keys(obj).filter((k) => obj[k] !== void 0).sort().map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`);
  return `{${entries.join(",")}}`;
}
var SEP = String.fromCharCode(0);
function hashEntry(e) {
  const material = [
    String(e.seq),
    e.at,
    e.kind,
    e.workflowId,
    e.clientId ?? "",
    canonical(e.payload),
    e.prevHash
  ].join(SEP);
  return createHash2("sha256").update(material).digest("hex");
}
var Ledger = class {
  constructor(path) {
    this.path = path;
    if (path && existsSync(path)) {
      this.entries = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    }
  }
  entries = [];
  get length() {
    return this.entries.length;
  }
  all() {
    return this.entries;
  }
  get head() {
    return this.entries.length === 0 ? GENESIS_PREV : this.entries[this.entries.length - 1].hash;
  }
  append(kind, workflowId, payload, opts = {}) {
    const draft = {
      seq: this.entries.length,
      at: opts.at ?? (/* @__PURE__ */ new Date()).toISOString(),
      kind,
      workflowId,
      clientId: opts.clientId,
      payload,
      prevHash: this.head
    };
    const entry = { ...draft, hash: hashEntry(draft) };
    this.entries.push(entry);
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, `${JSON.stringify(entry)}
`, "utf8");
    }
    return entry;
  }
  /** Entries for one workflow, oldest first. */
  forWorkflow(workflowId) {
    return this.entries.filter((e) => e.workflowId === workflowId);
  }
  /** Entries inside a period, for a client report. */
  between(fromIso, toIso, clientId) {
    const from = Date.parse(fromIso);
    const to = Date.parse(toIso);
    return this.entries.filter((e) => {
      const t = Date.parse(e.at);
      if (!(t >= from && t <= to)) return false;
      return clientId === void 0 || e.clientId === clientId;
    });
  }
  verify() {
    return verifyChain(this.entries);
  }
};
function verifyChain(entries) {
  let prev = GENESIS_PREV;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.seq !== i) {
      return { ok: false, brokenAt: i, reason: `Entry ${i} claims sequence ${e.seq}, so an entry was removed or reordered.` };
    }
    if (e.prevHash !== prev) {
      return { ok: false, brokenAt: i, reason: `Entry ${i} does not link to the entry before it, so something was inserted or deleted above it.` };
    }
    const recomputed = hashEntry({
      seq: e.seq,
      at: e.at,
      kind: e.kind,
      workflowId: e.workflowId,
      clientId: e.clientId,
      payload: e.payload,
      prevHash: e.prevHash
    });
    if (recomputed !== e.hash) {
      return { ok: false, brokenAt: i, reason: `Entry ${i} has been edited since it was written: its contents no longer produce its recorded hash.` };
    }
    prev = e.hash;
  }
  return { ok: true };
}

// src/contract/circularity.ts
var NON_SUBSTANTIVE = [
  "ok",
  "okay",
  "fine",
  "good",
  "looks good",
  "looks fine",
  "lgtm",
  "n/a",
  "na",
  "none",
  "yes",
  "sure",
  "idk",
  "i think so",
  "probably",
  "seems right",
  "no reason",
  "test",
  "asdf",
  "-",
  "."
];
var MIN_ATTESTATION_CHARS = 12;
function normalise(s) {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.!]+$/, "");
}
function isSubstantiveAttestation(howKnown) {
  const n = normalise(howKnown);
  if (n.length < MIN_ATTESTATION_CHARS) return false;
  if (NON_SUBSTANTIVE.includes(n)) return false;
  if (/^(it (was|is) )?(known )?good$/.test(n)) return false;
  if (n.split(" ").filter(Boolean).length < 3) return false;
  return true;
}
function confirmationRequirements(basis) {
  switch (basis) {
    case "intent":
      return {
        needsBaselineAttestation: false,
        proves: "that the workflow is doing the job a person said it was for",
        doesNotProve: "that the stated job is the job the business currently needs"
      };
    case "structure":
      return {
        needsBaselineAttestation: false,
        proves: "that the workflow is doing what its own definition says it does",
        doesNotProve: "that the definition was ever correct"
      };
    case "observation":
      return {
        needsBaselineAttestation: true,
        proves: "that behaviour has not changed since the attested window",
        doesNotProve: "that behaviour in that window was correct"
      };
  }
}
function confirmAssertion(assertion, confirmation, ctx) {
  if (assertion.status === "confirmed") {
    return refuse("already-confirmed", `"${assertion.statement}" is already confirmed. Retire it and propose a replacement rather than re-confirming.`);
  }
  if (assertion.status === "retired") {
    return refuse("retired", `"${assertion.statement}" was retired. Retired assertions are kept for the audit trail and cannot be revived.`);
  }
  if (!confirmation.by || !confirmation.by.trim()) {
    return refuse("confirmer-missing", "A confirmation has to name who took responsibility for it. That name is printed in the client report beside the result it produces.");
  }
  if (!confirmation.workflowHash || !confirmation.workflowHash.trim()) {
    return refuse("workflow-hash-missing", "A confirmation must be bound to a specific workflow revision, otherwise it silently outlives the thing it describes.");
  }
  if (confirmation.workflowHash !== ctx.currentWorkflowHash) {
    return refuse(
      "workflow-hash-mismatch",
      `This was confirmed against revision ${short(confirmation.workflowHash)} but the workflow is now at ${short(ctx.currentWorkflowHash)}. Re-read the assertion against the current graph before confirming it.`
    );
  }
  if (confirmation.evidenceRunIds.length === 0) {
    return refuse("no-evidence-runs", "Confirmations record which runs the confirmer was shown. Approving with no evidence in front of you is the habit this tool exists to interrupt.");
  }
  const req = confirmationRequirements(assertion.basis);
  if (!req.needsBaselineAttestation && confirmation.baselineAttestation) {
    return refuse(
      "attestation-on-non-observation-basis",
      `A baseline attestation only applies to expectations learned from past output. "${assertion.statement}" has basis "${assertion.basis}", so remove the attestation rather than implying this standard came from history.`
    );
  }
  if (req.needsBaselineAttestation) {
    const att = confirmation.baselineAttestation;
    if (!att) {
      return refuse(
        "observation-without-baseline-attestation",
        `"${assertion.statement}" was learned from what this workflow has been doing, so on its own it proves only that the behaviour has not changed. To make it a standard, state the window you believe was correct and how you know. If you cannot, leave it proposed and it will report as unproven, which is the honest answer.`
      );
    }
    if (!isValidWindow(att.windowStart, att.windowEnd)) {
      return refuse("baseline-window-invalid", "The attested window needs a real start and end, with the start before the end.");
    }
    if (!isSubstantiveAttestation(att.howKnown)) {
      return refuse(
        "baseline-attestation-not-substantive",
        `Say how you know that window was good, in a sentence someone could later check. "Reconciled against the client's invoice export for March" is an attestation. "Looks fine" is not, and it will be printed next to every green tick it produces.`
      );
    }
  }
  const confirmed = {
    ...assertion,
    status: "confirmed",
    confirmation
  };
  return { assertion: confirmed };
}
function isValidWindow(start, end) {
  const s = Date.parse(start);
  const e = Date.parse(end);
  return Number.isFinite(s) && Number.isFinite(e) && s < e;
}
function refuse(reason, message) {
  return { refused: { reason, message } };
}
function short(hash) {
  return hash.slice(0, 10);
}
function coverageHonesty(assertions) {
  const live = assertions.filter((a) => a.status === "confirmed");
  const byBasis = { intent: 0, structure: 0, observation: 0 };
  for (const a of live) byBasis[a.basis]++;
  const canEstablishCorrectness = byBasis.intent > 0;
  let sentence;
  if (live.length === 0) {
    sentence = "Nothing is being verified on this workflow. Any green you see elsewhere is the platform reporting that code ran, not that work happened.";
  } else if (!canEstablishCorrectness && byBasis.structure === 0) {
    sentence = `All ${live.length} live checks were learned from this workflow's own past output. They will catch it changing. They cannot show it was ever correct, because the standard came from the thing being measured.`;
  } else if (!canEstablishCorrectness) {
    sentence = `${live.length} live checks, none of which came from a stated business intent. They show the workflow matches its own definition and has not drifted. Whether the definition is right is still unverified.`;
  } else {
    sentence = `${byBasis.intent} of ${live.length} live checks trace back to a stated business intent rather than to past output, so they can establish correctness and not merely consistency.`;
  }
  return { live: live.length, byBasis, canEstablishCorrectness, sentence };
}
export {
  DEFAULT_GATE,
  Ledger,
  builtinBatches,
  checkBatch,
  checkConformance,
  checkConsistency,
  checkGrounding,
  confirmAssertion,
  coverageHonesty,
  demoTasks,
  extractAtoms,
  extractTrace,
  gate,
  groundingSourcesFor,
  hashEntry,
  isSubstantiveAttestation,
  looksDeferred,
  parseTaskRecords,
  scoreBatch,
  verifyChain
};
