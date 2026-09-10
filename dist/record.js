// src/record/recorder.ts
import { appendFileSync } from "node:fs";

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
  {
    kind: "money",
    re: /(?:[$£€¥₹]\s?\d[\d,]*(?:\.\d+)?)|(?:\d[\d,]*(?:\.\d+)?\s?(?:USD|GBP|EUR|INR|JPY|AUD|CAD|CHF))\b|(?:\b(?:USD|GBP|EUR|INR|JPY|AUD|CAD|CHF)\s?\d[\d,]*(?:\.\d+)?)/g
  },
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
var ORG_SUFFIX_SRC = String.raw`\b(?:ltd|limited|inc|incorporated|llc|l\.l\.c|llp|plc|gmbh|ag|s\.a|sa|s\.r\.l|srl|b\.v|bv|pvt|private|pte|co|corp|corporation|company|holdings?|group|partners?)\b\.?`;
function hasOrgSuffix(s) {
  return new RegExp(ORG_SUFFIX_SRC, "i").test(s);
}
function stripOrgSuffix(s) {
  return s.replace(new RegExp(ORG_SUFFIX_SRC, "gi"), "").replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}
function nameIsPresent(atom, sourceRaw, sourceNormalised) {
  if (sourceNormalised.includes(atom.key) || sourceRaw.includes(atom.text)) return true;
  if (!hasOrgSuffix(atom.text)) return false;
  const stripped = stripOrgSuffix(atom.key);
  if (stripped.length < 6 && stripped.split(" ").length < 2) return false;
  return stripOrgSuffix(sourceNormalised).includes(stripped);
}
function nearestSourceNumber(value, sourceNumbers) {
  let best = null;
  let bestGap = Infinity;
  const digits = String(Math.round(Math.abs(value)));
  for (const key of sourceNumbers) {
    const n = Number(key);
    if (!Number.isFinite(n) || n === value) continue;
    const gap = Math.abs(n - value);
    const rel = gap / Math.max(Math.abs(value), 1);
    const sameDigitsReordered = String(Math.round(Math.abs(n))).length === digits.length && String(Math.round(Math.abs(n))).split("").sort().join("") === digits.split("").sort().join("");
    if ((rel <= 0.02 || sameDigitsReordered) && gap < bestGap) {
      best = n;
      bestGap = gap;
    }
  }
  return best;
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
    case "name":
      return nameIsPresent(atom, sourceRaw, sourceNormalised);
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
    if (isPresent(atom, sourceRaw, sourceNormalised, sourceNumbers, sourceDates)) continue;
    let why = describe(atom);
    if (atom.kind === "money" || atom.kind === "number") {
      const near2 = nearestSourceNumber(Number(atom.key), sourceNumbers);
      if (near2 !== null) {
        why += `. The closest figure in the source is ${near2}, so this looks like a slip rather than an invention, but it is still not what the source says`;
      }
    }
    ungrounded.push({ ...atom, why });
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
  const pct2 = /\b(\d{1,2}(?:\.\d+)?)\s?%/.exec(text);
  const tax = labelled(text, TAX_LABELS);
  if (!sub || !pct2 || !tax || !pct2[1]) return;
  const rate2 = Number(pct2[1]) / 100;
  const expected = sub.value * rate2;
  if (Math.abs(expected - tax.value) > 0.5 + sub.value * 1e-3) {
    out.push({
      kind: "percentage",
      summary: `Tax is stated as ${pct2[1]}% but the amount does not match: ${pct2[1]}% of ${sub.value.toFixed(2)} is ${expected.toFixed(2)}, not ${tax.value.toFixed(2)}.`,
      evidence: `${sub.raw}; rate ${pct2[1]}%; ${tax.raw}`
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

// src/verify/association.ts
function splitRecords(source) {
  const headerRe = /\b((?:invoice|inv|order|ord|account|acct|ref|reference|po)[\s#:-]*[A-Z0-9][A-Z0-9-]{2,})/gi;
  const headers = [...source.matchAll(headerRe)];
  if (headers.length >= 2) {
    const out = [];
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].index ?? 0;
      const end = i + 1 < headers.length ? headers[i + 1].index ?? source.length : source.length;
      out.push({ label: headers[i][1].replace(/\s+/g, " ").trim(), text: source.slice(start, end) });
    }
    return out;
  }
  const blocks = source.split(/\n\s*\n/).map((b, i) => ({ label: `block ${i + 1}`, text: b })).filter((b) => /[£$€¥]\s?\d|\d[\d,]*\.\d{2}|\b(?:USD|GBP|EUR)\s?\d/.test(b.text));
  return blocks.length >= 2 ? blocks : [];
}
var MONEY_G = /[£$€¥]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*\.\d{2}|\b(?:USD|GBP|EUR|INR)\s?\d[\d,]*(?:\.\d+)?/g;
var DATE_G = /\b\d{4}-\d{2}-\d{2}\b/g;
function num(s) {
  return Number(s.replace(/[^0-9.]/g, ""));
}
function recordsContaining(records, test) {
  return records.filter((r) => test(r.text));
}
function checkAssociation(output, sources) {
  const source = sources.join("\n\n");
  const records = splitRecords(source);
  if (records.length < 2) return [];
  const out = [];
  const pairRe = /([£$€¥]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*\.\d{2}|(?:USD|GBP|EUR|INR)\s?\d[\d,]*(?:\.\d+)?)[^.\n]{0,60}?\bdue\b[^.\n]{0,20}?(\d{4}-\d{2}-\d{2})|\bdue\b[^.\n]{0,20}?(\d{4}-\d{2}-\d{2})[^.\n]{0,60}?([£$€¥]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*\.\d{2})/gi;
  for (const m of output.matchAll(pairRe)) {
    const amountRaw = (m[1] ?? m[4] ?? "").trim();
    const dateRaw = (m[2] ?? m[3] ?? "").trim();
    if (!amountRaw || !dateRaw) continue;
    const amountVal = num(amountRaw);
    const amountRecords = recordsContaining(records, (t) => {
      for (const a of t.matchAll(MONEY_G)) if (Math.abs(num(a[0]) - amountVal) < 5e-3) return true;
      return false;
    });
    const dateRecords = recordsContaining(records, (t) => t.includes(dateRaw));
    if (amountRecords.length !== 1 || dateRecords.length !== 1) continue;
    const amountRec = amountRecords[0];
    const dateRec = dateRecords[0];
    if (amountRec.label === dateRec.label) continue;
    const datesInAmountRec = [...amountRec.text.matchAll(DATE_G)].map((d) => d[0]);
    if (datesInAmountRec.length === 0 || datesInAmountRec.includes(dateRaw)) continue;
    out.push({
      summary: `The answer pairs ${amountRaw} with a due date of ${dateRaw}, but the source pairs them differently: ${amountRaw} belongs to ${amountRec.label} (due ${datesInAmountRec[0]}), and ${dateRaw} belongs to ${dateRec.label}. Both facts are in the source; the answer may be about the wrong record.`,
      evidence: `${amountRaw} in "${amountRec.label}"; ${dateRaw} in "${dateRec.label}"`
    });
  }
  const seen = /* @__PURE__ */ new Set();
  return out.filter((o) => seen.has(o.summary) ? false : (seen.add(o.summary), true));
}

// src/verify/distribution.ts
var MIN_BATCH = 8;
function fingerprint(s) {
  return s.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 400);
}
function median(xs) {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mad(xs, mid) {
  if (xs.length === 0) return 0;
  return median(xs.map((x) => Math.abs(x - mid)));
}
function rate(count, total) {
  return total > 0 ? count / total : 0;
}
function pct(x) {
  return `${Math.round(x * 100)}%`;
}
function checkDistribution(tasks) {
  const out = [];
  const n = tasks.length;
  if (n < MIN_BATCH) return out;
  const deferred = tasks.filter((t) => t.deferred);
  const refused = tasks.filter((t) => t.refused);
  const empty = tasks.filter((t) => t.empty);
  if (deferred.length >= 3 && rate(deferred.length, n) >= 0.25) {
    out.push({
      kind: "deferral-rate",
      severity: "concern",
      summary: `${deferred.length} of ${n} answers (${pct(rate(deferred.length, n))}) hand the task back to a human. Each one counts as a completed task, so a high resolution rate here means very little.`,
      sampleTaskIds: deferred.slice(0, 5).map((t) => t.id)
    });
  }
  if (refused.length >= 3 && rate(refused.length, n) >= 0.2) {
    out.push({
      kind: "refusal-rate",
      severity: "concern",
      summary: `${refused.length} of ${n} answers (${pct(rate(refused.length, n))}) are refusals carried downstream as content. That points at a prompt, a permission, or an upstream data problem rather than at any one answer.`,
      sampleTaskIds: refused.slice(0, 5).map((t) => t.id)
    });
  }
  if (empty.length >= 2 && rate(empty.length, n) >= 0.15) {
    out.push({
      kind: "empty-rate",
      severity: "concern",
      summary: `${empty.length} of ${n} answers (${pct(rate(empty.length, n))}) are empty or a bare null. The pipeline is recording a result where there is none.`,
      sampleTaskIds: empty.slice(0, 5).map((t) => t.id)
    });
  }
  const clusters = /* @__PURE__ */ new Map();
  for (const t of tasks) {
    if (t.empty) continue;
    const fp = fingerprint(t.output);
    let ids = clusters.get(fp);
    if (!ids) {
      ids = [];
      clusters.set(fp, ids);
    }
    ids.push(t.id);
  }
  let biggest = [];
  for (const ids of clusters.values()) if (ids.length > biggest.length) biggest = ids;
  if (biggest.length >= 5 && rate(biggest.length, n) >= 0.4) {
    out.push({
      kind: "collapse",
      severity: "concern",
      summary: `${biggest.length} of ${n} answers (${pct(rate(biggest.length, n))}) are the same response to different inputs. A pipeline that has stopped reading its input looks exactly like this.`,
      sampleTaskIds: biggest.slice(0, 5)
    });
  }
  const groundedTasks = tasks.filter((t) => t.grounded);
  if (groundedTasks.length >= MIN_BATCH) {
    const barren = groundedTasks.filter((t) => t.atomsChecked === 0);
    if (rate(barren.length, groundedTasks.length) >= 0.7) {
      out.push({
        kind: "atom-drought",
        severity: "notice",
        summary: `${barren.length} of ${groundedTasks.length} answers contain no figure, date, identifier or name to check against the source. Groundedness has very little to work with in this batch, so a clean result is a weak signal here.`,
        sampleTaskIds: barren.slice(0, 5).map((t) => t.id)
      });
    }
  }
  const lengths = tasks.filter((t) => !t.empty).map((t) => t.output.length);
  if (lengths.length >= MIN_BATCH) {
    const mid = median(lengths);
    const spread = mad(lengths, mid) * 1.4826 || 1;
    const outliers = tasks.filter((t) => !t.empty).map((t) => ({ id: t.id, z: (t.output.length - mid) / spread })).filter((t) => Math.abs(t.z) >= 6);
    if (outliers.length > 0 && outliers.length <= Math.max(2, Math.floor(n * 0.1))) {
      out.push({
        kind: "length-outlier",
        severity: "notice",
        summary: `${outliers.length} answer(s) are far shorter or longer than the rest of the batch. That is often where a truncation, a dump of raw context, or a different code path shows up.`,
        sampleTaskIds: outliers.slice(0, 5).map((t) => t.id)
      });
    }
  }
  return out;
}

// src/aiwork/record.ts
var INPUT_KEYS = ["input", "prompt", "question", "query", "task", "instruction", "request"];
var OUTPUT_KEYS = ["output", "response", "answer", "completion", "result", "generation", "text"];
var SOURCE_KEYS = ["sources", "context", "documents", "docs", "retrieved", "chunks", "evidence", "reference", "references", "ground_truth_context"];
var ID_KEYS = ["id", "task_id", "trace_id", "run_id", "request_id", "uuid"];
var TIME_KEYS = ["at", "timestamp", "time", "created_at", "started_at"];
var ALL_KEYS = /* @__PURE__ */ new Set([...INPUT_KEYS, ...OUTPUT_KEYS, ...SOURCE_KEYS, ...ID_KEYS, ...TIME_KEYS]);
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
function fingerprint2(s) {
  return createHash("sha256").update(s.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}
function checkBatch(records, opts = {}) {
  const duplicateThreshold = opts.duplicateThreshold ?? 3;
  const counts = /* @__PURE__ */ new Map();
  for (const r of records) {
    const fp = fingerprint2(r.output);
    counts.set(fp, (counts.get(fp) ?? 0) + 1);
  }
  const results = [];
  const byKind = {
    degenerate: 0,
    ungrounded: 0,
    deferred: 0,
    duplicated: 0,
    inconsistent: 0,
    malformed: 0,
    misattributed: 0
  };
  const taskSignals = [];
  for (const record of records) {
    const problems = [];
    let degenerateKind;
    for (const pattern of DEGENERATE_PATTERNS) {
      if (matchDegenerate(record.output, pattern)) {
        degenerateKind = pattern;
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
    const dupCount = counts.get(fingerprint2(record.output)) ?? 0;
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
    let inconclusive = false;
    let inconclusiveReason;
    let atomsChecked = 0;
    let groundingRan = false;
    if (!opts.skipGrounding) {
      const { sources, basis, note } = groundingSourcesFor(record);
      const g = checkGrounding(record.output, sources, opts);
      atomsChecked = g.checked;
      groundingRan = basis !== "none";
      if (basis === "sources") {
        for (const bad of checkAssociation(record.output, sources)) {
          problems.push({ kind: "misattributed", summary: bad.summary, evidence: bad.evidence });
        }
      }
      if (g.inconclusive) {
        inconclusive = problems.length === 0;
        inconclusiveReason = note ? `${g.reason} ${note}` : g.reason;
      } else if (basis === "prompt" && g.ungrounded.length > 0) {
        inconclusive = problems.length === 0;
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
    taskSignals.push({
      id: record.id,
      output: record.output,
      deferred: deferral.deferred,
      refused: degenerateKind === "model-refusal",
      empty: degenerateKind === "empty-string" || degenerateKind === "null-literal",
      atomsChecked,
      grounded: groundingRan
    });
    results.push({
      id: record.id,
      at: record.at,
      problems,
      inconclusive,
      inconclusiveReason,
      atomsChecked
    });
  }
  const signals = checkDistribution(taskSignals);
  const problematic = results.filter((r) => r.problems.length > 0).length;
  const inconclusiveCount = results.filter((r) => r.inconclusive).length;
  const clean = results.length - problematic - inconclusiveCount;
  const pct2 = results.length > 0 ? Math.round(problematic / results.length * 100) : 0;
  const headline = problematic === 0 ? `${results.length} answers checked, none carrying a problem this can detect.` : `${problematic} of ${results.length} answers (${pct2}%) contain something the pipeline reported as a success.`;
  return {
    results,
    summary: {
      total: results.length,
      clean,
      problematic,
      inconclusive: inconclusiveCount,
      byKind,
      headline,
      signals,
      caveat: "This checks whether an answer is empty, refused, unrendered, deferred, duplicated, self-contradictory, malformed when it should be structured, built from facts the source pairs differently, or contains specifics absent from its own source material. It does not check whether the answer is wise, complete or appropriate, and a clean result is not a claim that the work was good. No model was asked to grade another model."
    }
  };
}

// src/record/recorder.ts
function asText(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
function createRecorder(options = {}) {
  const buffer = [];
  const prefix = options.idPrefix ?? "task";
  let counter = 0;
  const nextId = () => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
  const commit = (record) => {
    buffer.push(record);
    if (options.flushEvery && buffer.length >= options.flushEvery) {
      void flush();
    }
    return record;
  };
  async function flush() {
    if (buffer.length === 0) return 0;
    const batch = buffer.splice(0, buffer.length);
    const sink = options.sink;
    if (!sink) return batch.length;
    if (typeof sink === "function") {
      await sink(batch);
      return batch.length;
    }
    if (typeof sink === "string") {
      const lines = batch.map((r) => JSON.stringify(r)).join("\n") + "\n";
      appendFileSync(sink, lines, "utf8");
      return batch.length;
    }
    const body = sink.project !== void 0 ? JSON.stringify({ project: sink.project, tasks: batch }) : batch.map((r) => JSON.stringify(r)).join("\n");
    const res = await fetch(new URL("/v1/batches", sink.url), {
      method: "POST",
      headers: {
        "content-type": sink.project !== void 0 ? "application/json" : "application/x-ndjson",
        "x-api-key": sink.apiKey
      },
      body
    });
    if (!res.ok) {
      buffer.unshift(...batch);
      const detail = await res.text().catch(() => "");
      throw new Error(`silentgreen sink rejected the batch (${res.status}): ${detail.slice(0, 300)}`);
    }
    return batch.length;
  }
  return {
    async task(seed, body) {
      const sources = [...seed.sources ?? []];
      const actions = [];
      const meta = { ...seed.meta ?? {} };
      let input = seed.input ?? "";
      let explicitOutput;
      const ctx = {
        source: (text) => {
          if (Array.isArray(text)) sources.push(...text.filter((s) => typeof s === "string" && s.trim()));
          else if (typeof text === "string" && text.trim()) sources.push(text);
        },
        action: (a) => actions.push(a),
        input: (t) => {
          input = t;
        },
        output: (t) => {
          explicitOutput = t;
        },
        meta: (patch) => Object.assign(meta, patch)
      };
      const returned = await body(ctx);
      const output = explicitOutput ?? asText(returned);
      commit({
        id: seed.id ?? nextId(),
        ...seed.at ? { at: seed.at } : { at: (/* @__PURE__ */ new Date()).toISOString() },
        input,
        sources,
        output,
        ...actions.length > 0 ? { actions } : {},
        ...Object.keys(meta).length > 0 ? { meta } : {}
      });
      return returned;
    },
    record(record) {
      return commit({
        id: record.id ?? nextId(),
        at: record.at ?? (/* @__PURE__ */ new Date()).toISOString(),
        input: record.input,
        sources: record.sources,
        output: record.output,
        ...record.actions && record.actions.length > 0 ? { actions: record.actions } : {},
        ...record.meta ? { meta: record.meta } : {}
      });
    },
    pending: () => [...buffer],
    check: (opts) => {
      const records = [...buffer];
      return { summary: checkBatch(records, opts).summary, records };
    },
    flush
  };
}
export {
  createRecorder
};
