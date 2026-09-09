#!/usr/bin/env node

// src/cli.ts
import { readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";

// src/verify/assert.ts
var EVIDENCE_MAX = 300;
function evidenceOf(v) {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s === void 0) return "undefined";
  return s.length > EVIDENCE_MAX ? `${s.slice(0, EVIDENCE_MAX)}\u2026 (${s.length} chars)` : s;
}
function fieldValue(item, path) {
  if (item === null || typeof item !== "object") return { found: false, value: void 0 };
  let cur = item;
  for (const seg of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(seg in cur)) {
      return { found: false, value: void 0 };
    }
    cur = cur[seg];
  }
  return { found: true, value: cur };
}
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
function severity(p) {
  switch (p) {
    case "unrendered-template":
      return 6;
    case "model-refusal":
      return 5;
    case "error-text-in-value":
      return 4;
    case "truncation-marker":
      return 3;
    case "null-literal":
      return 2;
    case "empty-string":
      return 1;
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
function unproven(a, reason) {
  return {
    assertionId: a.id,
    verdict: "unproven",
    statement: a.statement,
    basis: a.basis,
    unprovenReason: reason
  };
}
function proven(a, evidence) {
  return { assertionId: a.id, verdict: "proven", statement: a.statement, basis: a.basis, evidence };
}
function violated(a, detail, evidence) {
  return { assertionId: a.id, verdict: "violated", statement: a.statement, basis: a.basis, detail, evidence };
}
function evaluate(assertion, run, ctx = {}) {
  if (assertion.status === "proposed") return unproven(assertion, "only-proposed-assertions");
  if (assertion.status === "stale") return unproven(assertion, "contract-stale");
  if (assertion.status === "retired") return unproven(assertion, "assertion-not-applicable");
  if (ctx.currentWorkflowHash && assertion.confirmation && assertion.confirmation.workflowHash !== ctx.currentWorkflowHash) {
    return unproven(assertion, "contract-stale");
  }
  const p = assertion.params;
  if (p.kind === "cadence") {
    return unproven(assertion, "assertion-not-applicable");
  }
  const items = run.sinkOutputs[assertion.sinkId];
  if (items === void 0) {
    return unproven(assertion, "sink-not-captured");
  }
  switch (p.kind) {
    case "non-empty": {
      if (items.length === 0) {
        return violated(
          assertion,
          "The step produced no items. The run still reported success, which is how this goes unnoticed.",
          "[]"
        );
      }
      return proven(assertion, `${items.length} item(s)`);
    }
    case "volume": {
      if (items.length < p.min || items.length > p.max) {
        return violated(
          assertion,
          `Expected between ${p.min} and ${p.max} items, found ${items.length}.`,
          `${items.length} item(s)`
        );
      }
      return proven(assertion, `${items.length} item(s)`);
    }
    case "shape": {
      for (let i = 0; i < items.length; i++) {
        for (const f of p.fields) {
          const { found, value } = fieldValue(items[i], f);
          if (!found) {
            return violated(assertion, `Item ${i} has no field "${f}".`, evidenceOf(items[i]));
          }
          if (!p.allowNull && (value === null || value === void 0)) {
            return violated(assertion, `Item ${i} has field "${f}" but its value is ${value === null ? "null" : "undefined"}.`, evidenceOf(items[i]));
          }
        }
      }
      return proven(assertion, `${items.length} item(s) carried ${p.fields.length} required field(s)`);
    }
    case "not-degenerate": {
      const hits = /* @__PURE__ */ new Map();
      for (let i = 0; i < items.length; i++) {
        for (const f of p.fields) {
          const { found, value } = fieldValue(items[i], f);
          if (!found) continue;
          for (const pattern of p.patterns) {
            const key = `${f}|${pattern}`;
            if (hits.has(key)) continue;
            if (matchDegenerate(value, pattern)) {
              hits.set(key, { field: f, pattern, value, itemIndex: i });
            }
          }
        }
      }
      if (hits.size === 0) {
        return proven(assertion, `${items.length} item(s) checked against ${p.patterns.length} pattern(s)`);
      }
      const ranked = [...hits.values()].sort((a, b) => severity(b.pattern) - severity(a.pattern));
      const lead = ranked[0];
      const others = ranked.slice(1);
      const also = others.length > 0 ? ` Also affected in the same run: ${others.map((o) => `"${o.field}" (${o.pattern})`).join(", ")}.` : "";
      return violated(
        assertion,
        `Item ${lead.itemIndex}, field "${lead.field}" ${describeDegenerate(lead.pattern)}.${also}`,
        evidenceOf(lead.value)
      );
    }
    case "referential": {
      if (!run.triggerInput || run.triggerInput.length === 0) {
        return unproven(assertion, "run-data-unavailable");
      }
      const sourceValues = /* @__PURE__ */ new Set();
      for (const item of run.triggerInput) {
        const { found, value } = fieldValue(item, p.sourceField);
        if (found && value !== null && value !== void 0) sourceValues.add(String(value));
      }
      if (sourceValues.size === 0) return unproven(assertion, "run-data-unavailable");
      for (let i = 0; i < items.length; i++) {
        const { found, value } = fieldValue(items[i], p.sinkField);
        if (!found) {
          return violated(assertion, `Item ${i} has no field "${p.sinkField}" to carry the input value into.`, evidenceOf(items[i]));
        }
        if (!sourceValues.has(String(value))) {
          return violated(
            assertion,
            `Item ${i} has "${p.sinkField}" = ${evidenceOf(value)}, which does not match any "${p.sourceField}" that entered this run. The step produced output that did not come from its input.`,
            evidenceOf(value)
          );
        }
      }
      return proven(assertion, `${items.length} item(s) traced back to the run's own input`);
    }
    case "predicate": {
      for (let i = 0; i < items.length; i++) {
        const { found, value } = fieldValue(items[i], p.field);
        if (!found) {
          return violated(assertion, `Item ${i} has no field "${p.field}".`, evidenceOf(items[i]));
        }
        if (!testPredicate(value, p.op, p.value)) {
          return violated(
            assertion,
            `Item ${i}: "${p.field}" ${evidenceOf(value)} fails ${p.op} ${JSON.stringify(p.value)}.`,
            evidenceOf(value)
          );
        }
      }
      return proven(assertion, `${items.length} item(s) satisfied the predicate`);
    }
  }
}
function testPredicate(value, op, expected) {
  switch (op) {
    case "equals":
      return String(value) === String(expected);
    case "not-equals":
      return String(value) !== String(expected);
    case "matches":
      return safeRegex(String(expected)).test(String(value));
    case "not-matches":
      return !safeRegex(String(expected)).test(String(value));
    case "gt":
      return numeric(value) > numeric(expected);
    case "lt":
      return numeric(value) < numeric(expected);
    case "gte":
      return numeric(value) >= numeric(expected);
    case "lte":
      return numeric(value) <= numeric(expected);
    default:
      return false;
  }
}
function numeric(v) {
  const n = typeof v === "number" ? v : Number(String(v));
  return Number.isFinite(n) ? n : NaN;
}
function safeRegex(src) {
  try {
    return new RegExp(src);
  } catch {
    return /$^/;
  }
}

// src/verify/cadence.ts
var MINIMUM_RUNS_TO_INFER = 6;
function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function inferCadence(runs) {
  const starts = runs.map((r) => Date.parse(r.startedAt)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  if (starts.length < MINIMUM_RUNS_TO_INFER) return null;
  const weekdaysOnly = !starts.some((t) => {
    const d = new Date(t).getUTCDay();
    return d === 0 || d === 6;
  });
  const hours = starts.map((t) => new Date(t).getUTCHours());
  const minHour = Math.min(...hours);
  const maxHour = Math.max(...hours);
  const activeHours = maxHour - minHour <= 14 && starts.length >= 10 ? { from: minHour, to: maxHour } : void 0;
  const shape = { weekdaysOnly, activeHours };
  const allIntervals = [];
  const workingIntervals = [];
  for (let i = 1; i < starts.length; i++) {
    const gap = (starts[i] - starts[i - 1]) / 1e3;
    if (gap <= 0) continue;
    allIntervals.push(gap);
    if (nonWorkingSeconds(starts[i - 1], starts[i], shape) === 0) workingIntervals.push(gap);
  }
  if (allIntervals.length === 0) return null;
  const excludedStructuralGaps = allIntervals.length - workingIntervals.length;
  const basis = workingIntervals.length >= 3 ? workingIntervals : allIntervals;
  const sorted = [...basis].sort((a, b) => a - b);
  const median = quantile(sorted, 0.5);
  const p95 = quantile(sorted, 0.95);
  const spread = median > 0 ? p95 / median : Infinity;
  let confidence;
  let reasoning;
  if (sorted.length >= 20 && spread <= 1.5) {
    confidence = "high";
    reasoning = `${sorted.length} intervals, tightly clustered around ${humanise(median)}. This looks like a schedule, and a missed run should be obvious quickly.`;
  } else if (sorted.length >= 10 && spread <= 4) {
    confidence = "moderate";
    reasoning = `${sorted.length} intervals with a typical gap of ${humanise(median)} and a long tail out to ${humanise(p95)}. Usable, but expect the occasional legitimate late run.`;
  } else {
    confidence = "low";
    reasoning = `Only ${sorted.length} intervals, ranging widely (typical ${humanise(median)}, tail ${humanise(p95)}). This is probably event driven rather than scheduled, so an absence alarm here will be noisy. Consider a volume expectation over a day instead.`;
  }
  if (weekdaysOnly) {
    reasoning += " No run has ever started at a weekend, so weekend gaps are excluded from the rhythm rather than treated as incidents.";
  }
  if (activeHours) {
    reasoning += ` Runs only ever start between ${String(activeHours.from).padStart(2, "0")}:00 and ${String(activeHours.to).padStart(2, "0")}:59, so overnight silence is expected too.`;
  }
  if (excludedStructuralGaps > 0) {
    reasoning += ` ${excludedStructuralGaps} gap(s) that crossed non-working time were excluded from the calculation, which is what keeps the expectation tight enough to be useful.`;
  }
  return {
    medianIntervalSeconds: Math.round(median),
    p95IntervalSeconds: Math.round(p95),
    weekdaysOnly,
    activeHours,
    sampleSize: sorted.length,
    confidence,
    reasoning
  };
}
function nonWorkingSeconds(fromMs, toMs, shape) {
  if (!shape.weekdaysOnly && !shape.activeHours) return 0;
  let acc = 0;
  const STEP = 15 * 60 * 1e3;
  for (let t = fromMs; t < toMs; t += STEP) {
    const d = new Date(t);
    const day = d.getUTCDay();
    const hour = d.getUTCHours();
    const offDay = shape.weekdaysOnly === true && (day === 0 || day === 6);
    const offHour = shape.activeHours ? hour < shape.activeHours.from || hour > shape.activeHours.to : false;
    if (offDay || offHour) acc += STEP / 1e3;
  }
  return acc;
}
function evaluateCadence(assertion, runs, ctx) {
  const base = {
    assertionId: assertion.id,
    statement: assertion.statement,
    basis: assertion.basis
  };
  if (assertion.status !== "confirmed") {
    return { ...base, verdict: "unproven", unprovenReason: assertion.status === "stale" ? "contract-stale" : "only-proposed-assertions" };
  }
  if (assertion.params.kind !== "cadence") {
    return { ...base, verdict: "unproven", unprovenReason: "assertion-not-applicable" };
  }
  if (ctx.currentWorkflowHash && assertion.confirmation && assertion.confirmation.workflowHash !== ctx.currentWorkflowHash) {
    return { ...base, verdict: "unproven", unprovenReason: "contract-stale" };
  }
  const starts = runs.map((r) => Date.parse(r.startedAt)).filter((t) => Number.isFinite(t)).sort((a, b) => b - a);
  if (starts.length === 0) {
    return { ...base, verdict: "unproven", unprovenReason: "run-data-unavailable" };
  }
  const last = starts[0];
  const nowMs = ctx.now.getTime();
  const rawSilence = (nowMs - last) / 1e3;
  const discounted = rawSilence - nonWorkingSeconds(last, nowMs, { weekdaysOnly: ctx.weekdaysOnly, activeHours: ctx.activeHours });
  const allowance = assertion.params.expectEverySeconds + assertion.params.graceSeconds;
  if (discounted > allowance) {
    const detail = rawSilence !== discounted ? `Last run was ${humanise(rawSilence)} ago (${humanise(discounted)} of working time, once hours it never runs in are discounted). Expected one every ${humanise(assertion.params.expectEverySeconds)} with ${humanise(assertion.params.graceSeconds)} of grace. Nothing has failed, because nothing has run.` : `Last run was ${humanise(rawSilence)} ago. Expected one every ${humanise(assertion.params.expectEverySeconds)} with ${humanise(assertion.params.graceSeconds)} of grace. Nothing has failed, because nothing has run.`;
    return {
      ...base,
      verdict: "violated",
      detail,
      evidence: new Date(last).toISOString()
    };
  }
  return { ...base, verdict: "proven", evidence: `last run ${new Date(last).toISOString()}` };
}
function humanise(seconds) {
  const s = Math.round(seconds);
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  const h = s / 3600;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)}h`;
  const d = s / 86400;
  return `${d.toFixed(d < 10 ? 1 : 0)} days`;
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

// src/graph/hash.ts
import { createHash } from "node:crypto";
var COSMETIC_NODE_KEYS = /* @__PURE__ */ new Set(["position", "notes", "notesInFlow", "color", "name"]);
var COSMETIC_PARAM_KEYS = /* @__PURE__ */ new Set(["notice", "__rl_display", "cachedResultName", "cachedResultUrl"]);
function nodeKey(n) {
  return n.id && n.id.trim() ? n.id : `name:${n.name}`;
}
function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) {
      if (COSMETIC_PARAM_KEYS.has(k)) continue;
      out[k] = sortValue(v[k]);
    }
    return out;
  }
  return v;
}
function canonicalise(doc) {
  const nodes = doc.nodes ?? [];
  const nameToKey = /* @__PURE__ */ new Map();
  for (const n of nodes) nameToKey.set(n.name, nodeKey(n));
  const canonicalNodes = nodes.map((n) => {
    const params = {};
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
      credentialTypes: Object.keys(n.credentials ?? {}).sort()
    };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const edges = [];
  for (const [fromName, outputs] of Object.entries(doc.connections ?? {})) {
    const from = nameToKey.get(fromName);
    if (!from) continue;
    for (const [outputType, branches] of Object.entries(outputs)) {
      branches.forEach((branch, outputIndex) => {
        for (const c2 of branch ?? []) {
          const to = nameToKey.get(c2.node);
          if (!to) continue;
          edges.push({
            from,
            outputType,
            outputIndex,
            to,
            inputIndex: c2.index ?? 0
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
function workflowHash(doc) {
  return createHash("sha256").update(JSON.stringify(canonicalise(doc))).digest("hex");
}
function diffWorkflows(before, after) {
  const a = canonicalise(before);
  const b = canonicalise(after);
  const changes = [];
  const aNodes = new Map(a.nodes.map((n) => [n.id, n]));
  const bNodes = new Map(b.nodes.map((n) => [n.id, n]));
  const displayName = /* @__PURE__ */ new Map();
  for (const n of after.nodes ?? []) displayName.set(nodeKey(n), n.name);
  for (const n of before.nodes ?? []) if (!displayName.has(nodeKey(n))) displayName.set(nodeKey(n), n.name);
  const label = (id) => displayName.get(id) ?? id;
  for (const [id, node] of bNodes) {
    if (!aNodes.has(id)) {
      changes.push({ kind: "node-added", nodeId: id, description: `"${label(id)}" (${node.type}) was added.` });
    }
  }
  for (const [id, node] of aNodes) {
    if (!bNodes.has(id)) {
      changes.push({ kind: "node-removed", nodeId: id, description: `"${label(id)}" (${node.type}) was removed. Any check bound to it can no longer be evaluated.` });
    }
  }
  for (const [id, an] of aNodes) {
    const bn = bNodes.get(id);
    if (!bn) continue;
    if (an.type !== bn.type) {
      changes.push({ kind: "node-type-changed", nodeId: id, description: `"${label(id)}" changed from ${an.type} to ${bn.type}.` });
      continue;
    }
    if (an.typeVersion !== bn.typeVersion) {
      changes.push({ kind: "node-version-changed", nodeId: id, description: `"${label(id)}" moved from version ${an.typeVersion} to ${bn.typeVersion}, which can change its output shape.` });
    }
    if (JSON.stringify(an.parameters) !== JSON.stringify(bn.parameters)) {
      changes.push({ kind: "node-parameters-changed", nodeId: id, description: `"${label(id)}" had its parameters changed.` });
    }
    if (an.disabled !== bn.disabled) {
      changes.push({
        kind: bn.disabled ? "node-disabled" : "node-enabled",
        nodeId: id,
        description: bn.disabled ? `"${label(id)}" was disabled, so anything downstream of it may now receive nothing while the run still reports success.` : `"${label(id)}" was re-enabled.`
      });
    }
    if (an.credentialTypes.join(",") !== bn.credentialTypes.join(",")) {
      changes.push({ kind: "node-credentials-changed", nodeId: id, description: `"${label(id)}" now uses different credential types.` });
    }
  }
  const edgeStr = (e) => `${e.from}|${e.outputType}|${e.outputIndex}|${e.to}|${e.inputIndex}`;
  const aEdges = new Set(a.edges.map(edgeStr));
  const bEdges = new Set(b.edges.map(edgeStr));
  for (const e of b.edges) {
    if (!aEdges.has(edgeStr(e))) {
      changes.push({ kind: "edge-added", description: `"${label(e.from)}" now feeds "${label(e.to)}".` });
    }
  }
  for (const e of a.edges) {
    if (!bEdges.has(edgeStr(e))) {
      changes.push({ kind: "edge-removed", description: `"${label(e.from)}" no longer feeds "${label(e.to)}".` });
    }
  }
  if (JSON.stringify(a.settings) !== JSON.stringify(b.settings)) {
    changes.push({ kind: "settings-changed", description: "Workflow settings changed, which can affect error handling and execution order." });
  }
  return changes;
}

// src/audit.ts
function worst(results) {
  if (results.some((r) => r.verdict === "violated")) return "violated";
  if (results.some((r) => r.verdict === "unproven")) return "unproven";
  return "proven";
}
function audit(input) {
  const live = input.assertions.filter((a) => a.status !== "retired");
  const perRunAssertions = live.filter((a) => a.kind !== "cadence");
  const cadenceAssertions = live.filter((a) => a.kind === "cadence");
  const perRun = [];
  const violations = [];
  const counts = { proven: 0, violated: 0, unproven: 0 };
  const unprovenBreakdown = {};
  const violatedAssertionIds = /* @__PURE__ */ new Set();
  let runsWithViolations = 0;
  for (const run of input.runs) {
    const results = perRunAssertions.map((a) => evaluate(a, run, { currentWorkflowHash: input.currentHash }));
    for (const r of results) {
      counts[r.verdict] += 1;
      if (r.verdict === "unproven" && r.unprovenReason) {
        unprovenBreakdown[r.unprovenReason] = (unprovenBreakdown[r.unprovenReason] ?? 0) + 1;
      }
      if (r.verdict === "violated") {
        violatedAssertionIds.add(r.assertionId);
        violations.push({ runId: run.id, at: run.startedAt, result: r });
      }
    }
    if (results.some((r) => r.verdict === "violated")) runsWithViolations += 1;
    perRun.push({
      runId: run.id,
      workflowId: run.workflowId,
      evaluatedAt: input.now.toISOString(),
      results,
      summary: worst(results)
    });
  }
  let cadence;
  for (const a of cadenceAssertions) {
    const r = evaluateCadence(a, input.runs, {
      now: input.now,
      weekdaysOnly: input.cadenceShape?.weekdaysOnly,
      activeHours: input.cadenceShape?.activeHours,
      currentWorkflowHash: input.currentHash
    });
    counts[r.verdict] += 1;
    if (r.verdict === "unproven" && r.unprovenReason) {
      unprovenBreakdown[r.unprovenReason] = (unprovenBreakdown[r.unprovenReason] ?? 0) + 1;
    }
    if (r.verdict === "violated") {
      violatedAssertionIds.add(r.assertionId);
      violations.push({ result: r });
    }
    cadence = r;
  }
  const drift = input.previousDoc && input.currentDoc ? diffWorkflows(input.previousDoc, input.currentDoc) : [];
  const platformReportedFailures = input.runs.filter((r) => r.platformStatus === "error").length;
  const honesty = coverageHonesty(input.assertions);
  return {
    workflowId: input.workflowId,
    workflowName: input.workflowName,
    runsExamined: input.runs.length,
    platformReportedFailures,
    perRun,
    cadence,
    violations,
    runsWithViolations,
    assertionsViolated: violatedAssertionIds.size,
    counts,
    unprovenBreakdown,
    honesty,
    drift,
    headline: headlineFor({
      runs: input.runs.length,
      platformReportedFailures,
      runsWithViolations,
      counts,
      cadenceViolated: cadence?.verdict === "violated",
      liveChecks: honesty.live
    })
  };
}
function headlineFor(a) {
  if (a.liveChecks === 0) {
    return `Nothing is being verified on this workflow. ${a.runs} runs were examined and none of them was checked against anything, so the ${a.runs - a.platformReportedFailures} successes mean only that code ran without throwing.`;
  }
  if (a.cadenceViolated && a.runsWithViolations === 0) {
    return `This workflow has stopped running. Nothing has failed, because nothing has been attempted, which is why no error appears anywhere.`;
  }
  if (a.runsWithViolations === 0 && a.counts.violated === 0) {
    const caveat = a.counts.unproven > 0 ? ` ${a.counts.unproven} checks could not be established and are listed below.` : "";
    return `${a.runs} runs examined, ${a.counts.proven} checks held.${caveat}`;
  }
  const pct = Math.round(a.runsWithViolations / Math.max(1, a.runs) * 100);
  return `${a.runsWithViolations} of ${a.runs} runs (${pct}%) produced output that violated a confirmed expectation, while the platform recorded ${a.platformReportedFailures} failures.`;
}

// src/demo/scenario.ts
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = a + 1831565813 >>> 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var DEMO_WORKFLOW_ID = "wf_order_sync";
function demoWorkflow(withRetryEdit = false) {
  return {
    id: DEMO_WORKFLOW_ID,
    name: "Shopify orders to Postgres and confirmation email",
    nodes: [
      {
        id: "trg",
        name: "Every hour",
        type: "n8n-nodes-base.scheduleTrigger",
        typeVersion: 1.2,
        position: [0, 0],
        parameters: { rule: { interval: [{ field: "hours", hoursInterval: 1 }] } }
      },
      {
        id: "fetch",
        name: "Fetch new orders",
        type: "n8n-nodes-base.httpRequest",
        typeVersion: 4.2,
        position: [200, 0],
        parameters: withRetryEdit ? { method: "GET", url: "https://api.shop.example/v2/orders", retryOnFail: true, maxTries: 3 } : { method: "GET", url: "https://api.shop.example/v2/orders" }
      },
      {
        id: "map",
        name: "Map order fields",
        type: "n8n-nodes-base.set",
        typeVersion: 3.4,
        position: [400, 0],
        parameters: { mode: "manual", fields: ["order_id", "customer_email", "total"] }
      },
      {
        id: "db",
        name: "Insert into orders",
        type: "n8n-nodes-base.postgres",
        typeVersion: 2.5,
        position: [600, -100],
        parameters: { operation: "insert", table: "orders" },
        credentials: { postgres: { id: "3", name: "prod db" } }
      },
      {
        id: "mail",
        name: "Send confirmation",
        type: "n8n-nodes-base.gmail",
        typeVersion: 2.1,
        position: [600, 100],
        parameters: { operation: "send", subject: "Your order is confirmed" },
        credentials: { gmailOAuth2: { id: "7", name: "orders@" } }
      }
    ],
    connections: {
      "Every hour": { main: [[{ node: "Fetch new orders", type: "main", index: 0 }]] },
      "Fetch new orders": { main: [[{ node: "Map order fields", type: "main", index: 0 }]] },
      "Map order fields": {
        main: [
          [
            { node: "Insert into orders", type: "main", index: 0 },
            { node: "Send confirmation", type: "main", index: 0 }
          ]
        ]
      }
    },
    settings: { executionOrder: "v1" }
  };
}
var DAY_MS = 864e5;
function demoTimeline(seed = 20260909) {
  const rand = mulberry32(seed);
  const runs = [];
  const breakageDay = 22;
  const editDay = 27;
  const silenceDay = 31;
  const totalDays = 42;
  const start = Date.UTC(2026, 6, 6, 0, 0, 0);
  for (let day = 0; day < totalDays; day++) {
    const dayStart = start + day * DAY_MS;
    const dow = new Date(dayStart).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (day >= silenceDay) continue;
    for (let hour = 9; hour <= 17; hour++) {
      const at = dayStart + hour * 36e5;
      const broken = day >= breakageDay;
      const count = 40 + Math.floor(rand() * 21);
      const orders = [];
      const emails = [];
      for (let i = 0; i < count; i++) {
        const orderId = `ORD-${day}-${hour}-${i}`;
        const firstName = ["Priya", "Tomas", "Aiko", "Sofia", "Daniel"][Math.floor(rand() * 5)];
        const total = Math.round((20 + rand() * 180) * 100) / 100;
        orders.push({
          order_id: orderId,
          // The whole incident, in one field. Before the rename this carries an
          // address; after it, the mapping silently resolves to null and the
          // insert happily writes it.
          customer_email: broken ? null : `${firstName.toLowerCase()}@example.com`,
          total,
          synced_at: new Date(at).toISOString()
        });
        emails.push({
          to: broken ? "null" : `${firstName.toLowerCase()}@example.com`,
          subject: "Your order is confirmed",
          // Once the upstream field is gone the expression never resolves, and
          // the template ships to a real customer exactly as written.
          body: broken ? "Hi {{ $json.firstName }}, your order is confirmed. Total: {{ $json.total }}" : `Hi ${firstName}, your order is confirmed. Total: ${total.toFixed(2)}`,
          order_id: orderId
        });
      }
      runs.push({
        id: `exec_${day}_${hour}`,
        workflowId: DEMO_WORKFLOW_ID,
        platform: "n8n",
        startedAt: new Date(at).toISOString(),
        finishedAt: new Date(at + 4200).toISOString(),
        // This is the point of the entire exercise.
        platformStatus: "success",
        sinkOutputs: { db: orders, mail: emails },
        triggerInput: orders.map((o) => ({ order_id: o.order_id }))
      });
    }
  }
  return {
    runs,
    breakageDay,
    editDay,
    silenceDay,
    startedAt: new Date(start).toISOString(),
    now: new Date(start + totalDays * DAY_MS).toISOString()
  };
}
function platformSummary(t) {
  const executions = t.runs.length;
  const failed = t.runs.filter((r) => r.platformStatus === "error").length;
  return {
    executions,
    succeeded: executions - failed,
    failed,
    sentence: `${executions} executions, ${executions - failed} successful, ${failed} failed.`
  };
}

// src/contract/sinks.ts
var CATEGORIES = [
  { category: "datastore", match: /\.(postgres|mySql|mongoDb|redis|supabase|snowflake|questDb|timescaleDb|crateDb|elasticsearch)$/i, weight: 95 },
  { category: "spreadsheet", match: /\.(googleSheets|microsoftExcel|airtable|nocoDb|baserow|notion|coda)$/i, weight: 92 },
  { category: "crm-or-billing", match: /\.(hubspot|salesforce|pipedrive|zohoCrm|stripe|shopify|quickbooks|xero|chargebee|freshworksCrm|copper)$/i, weight: 94 },
  { category: "email", match: /\.(gmail|emailSend|sendGrid|mailgun|microsoftOutlook|sendInBlue|brevo)$/i, weight: 88 },
  { category: "messaging", match: /\.(slack|telegram|discord|twilio|whatsApp|microsoftTeams|pushover|mattermost)$/i, weight: 82 },
  { category: "file-storage", match: /\.(awsS3|googleDrive|dropbox|ftp|sftp|box|oneDrive)$/i, weight: 80 },
  { category: "webhook-response", match: /\.respondToWebhook$/i, weight: 90 },
  { category: "ai-generation", match: /\.(openAi|anthropic|lmChat|chainLlm|agent|informationExtractor|textClassifier)/i, weight: 70 }
];
function categorise(type) {
  for (const c2 of CATEGORIES) {
    if (c2.match.test(type)) return { category: c2.category, weight: c2.weight };
  }
  return void 0;
}
function httpIsWrite(node) {
  const method = String(node.parameters?.["method"] ?? "GET").toUpperCase();
  return method !== "GET" && method !== "HEAD";
}
function describe(category, name, terminal) {
  const tail = terminal ? " Nothing downstream consumes it, so if it produces nothing the run still ends green." : "";
  switch (category) {
    case "datastore":
      return `"${name}" writes to a database, so an empty run here is data that quietly never arrived.${tail}`;
    case "spreadsheet":
      return `"${name}" writes rows a person will later read as fact.${tail}`;
    case "crm-or-billing":
      return `"${name}" touches records with money or customers attached, where a silent miss is expensive.${tail}`;
    case "email":
      return `"${name}" sends email. An empty or half-rendered send reaches a real inbox and cannot be recalled.${tail}`;
    case "messaging":
      return `"${name}" posts a message someone is expected to act on.${tail}`;
    case "file-storage":
      return `"${name}" writes files that other systems or people pick up later.${tail}`;
    case "outbound-http":
      return `"${name}" sends a request that changes something in another system, so a run that reaches it and posts nothing leaves the two systems disagreeing.${tail}`;
    case "webhook-response":
      return `"${name}" is what the caller receives. If it is empty the caller sees a successful, useless response.${tail}`;
    case "ai-generation":
      return `"${name}" generates content with a model, which can decline or return something shaped correctly and substantively wrong.${tail}`;
    case "terminal":
      return `"${name}" is where this branch ends. Whatever it produces is the run's result.${tail}`;
  }
}
function findSinks(doc) {
  const canonical2 = canonicalise(doc);
  const outgoing = new Set(canonical2.edges.map((e) => e.from));
  const byId = /* @__PURE__ */ new Map();
  for (const n of doc.nodes ?? []) {
    byId.set(n.id && n.id.trim() ? n.id : `name:${n.name}`, n);
  }
  const sinks = [];
  for (const [nodeId, node] of byId) {
    if (node.disabled === true) continue;
    if (/trigger$/i.test(node.type) || /\.webhook$/i.test(node.type)) continue;
    const terminal = !outgoing.has(nodeId);
    const cat = categorise(node.type);
    let category;
    let weight = 0;
    if (cat) {
      category = cat.category;
      weight = cat.weight;
    } else if (/\.httpRequest$/i.test(node.type)) {
      if (httpIsWrite(node)) {
        category = "outbound-http";
        weight = 86;
      } else if (terminal) {
        category = "terminal";
        weight = 55;
      }
    } else if (terminal && !/\.(noOp|stickyNote|set|code|if|switch|merge|splitInBatches|filter)$/i.test(node.type)) {
      category = "terminal";
      weight = 60;
    }
    if (!category) continue;
    const importance = Math.min(100, weight + (terminal ? 8 : 0));
    sinks.push({
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      category,
      importance,
      rationale: describe(category, node.name, terminal),
      terminal
    });
  }
  return sinks.sort((a, b) => b.importance - a.importance || a.nodeName.localeCompare(b.nodeName));
}

// src/contract/infer.ts
var counter = 0;
function nextId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}
function makeAssertion(workflowId, sinkId, basis, statement, params) {
  return {
    id: nextId("as"),
    workflowId,
    sinkId,
    kind: params.kind,
    basis,
    statement,
    params,
    status: "proposed",
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function proposeFromStructure(workflowId, workflowHash2, sinks) {
  const out = [];
  for (const sink of sinks) {
    out.push({
      assertion: makeAssertion(
        workflowId,
        sink.nodeId,
        "structure",
        `"${sink.nodeName}" produces at least one item on every run`,
        { kind: "non-empty" }
      ),
      rationale: sink.rationale,
      confidence: sink.terminal ? "high" : "moderate",
      derivedFrom: { kind: "structure", workflowHash: workflowHash2 }
    });
    if (sink.category === "ai-generation" || sink.category === "email" || sink.category === "messaging") {
      out.push({
        assertion: makeAssertion(
          workflowId,
          sink.nodeId,
          "structure",
          `"${sink.nodeName}" never sends an empty, unrendered or refused message`,
          {
            kind: "not-degenerate",
            fields: [],
            patterns: ["empty-string", "unrendered-template", "model-refusal", "error-text-in-value", "null-literal"]
          }
        ),
        rationale: sink.category === "ai-generation" ? "Generated text fails in ways a status code cannot express: the model declines, or a template variable never resolved and the placeholder ships as-is." : 'This step delivers text to a person. An unrendered "{{ $json.firstName }}" reaching a customer is a visible failure that the platform records as a success.',
        confidence: "high",
        derivedFrom: { kind: "structure", workflowHash: workflowHash2 }
      });
    }
  }
  return out;
}
function pathsOf(item, prefix = "", depth = 0) {
  if (item === null || typeof item !== "object" || Array.isArray(item)) return [];
  const out = [];
  for (const [k, v] of Object.entries(item)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.push({ path, value: v });
    if (depth < 1 && v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...pathsOf(v, path, depth + 1));
    }
  }
  return out;
}
function fieldStats(items) {
  const acc = /* @__PURE__ */ new Map();
  for (const item of items) {
    for (const { path, value } of pathsOf(item)) {
      const e = acc.get(path) ?? { present: 0, nulls: 0, strings: 0, totalLen: 0 };
      e.present += 1;
      if (value === null || value === void 0) e.nulls += 1;
      if (typeof value === "string") {
        e.strings += 1;
        e.totalLen += value.length;
      }
      acc.set(path, e);
    }
  }
  return [...acc.entries()].map(([field, e]) => ({
    field,
    presentIn: e.present,
    nullIn: e.nulls,
    stringIn: e.strings,
    meanLength: e.strings > 0 ? e.totalLen / e.strings : 0
  })).sort((a, b) => b.presentIn - a.presentIn);
}
function quantile2(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
var MIN_RUNS_FOR_OBSERVATION = 10;
var FIELD_UBIQUITY_THRESHOLD = 0.98;
function proposeFromObservation(workflowId, sinks, runs) {
  const out = [];
  const successful = runs.filter((r) => r.platformStatus === "success");
  if (successful.length < MIN_RUNS_FOR_OBSERVATION) return out;
  const runIds = successful.map((r) => r.id);
  for (const sink of sinks) {
    const counts = [];
    const allItems = [];
    let runsWithCapture = 0;
    for (const run of successful) {
      const items = run.sinkOutputs[sink.nodeId];
      if (items === void 0) continue;
      runsWithCapture += 1;
      counts.push(items.length);
      allItems.push(...items);
    }
    if (runsWithCapture < MIN_RUNS_FOR_OBSERVATION) continue;
    const sorted = [...counts].sort((a, b) => a - b);
    const p05 = quantile2(sorted, 0.05);
    const p95 = quantile2(sorted, 0.95);
    const min = Math.max(0, Math.floor(p05 * 0.5));
    const max = Math.ceil(Math.max(p95 * 2, p95 + 5));
    const everyRunHadItems = sorted[0] > 0;
    if (everyRunHadItems) {
      out.push({
        assertion: makeAssertion(
          workflowId,
          sink.nodeId,
          "observation",
          `"${sink.nodeName}" produces between ${Math.max(1, min)} and ${max} items per run`,
          { kind: "volume", min: Math.max(1, min), max }
        ),
        rationale: `Across ${runsWithCapture} successful runs this step produced between ${sorted[0]} and ${sorted[sorted.length - 1]} items, typically ${Math.round(quantile2(sorted, 0.5))}. The bounds are set wide, so this catches a collapse or a runaway rather than ordinary variation.`,
        confidence: runsWithCapture >= 30 ? "high" : "moderate",
        derivedFrom: { kind: "observation", runIds, sampleSize: runsWithCapture }
      });
    }
    const stats = fieldStats(allItems);
    const ubiquitous = stats.filter((s) => allItems.length > 0 && s.presentIn / allItems.length >= FIELD_UBIQUITY_THRESHOLD && s.nullIn === 0);
    const shapeFields = ubiquitous.slice(0, 8).map((s) => s.field);
    if (shapeFields.length > 0 && allItems.length >= 20) {
      out.push({
        assertion: makeAssertion(
          workflowId,
          sink.nodeId,
          "observation",
          `Every item from "${sink.nodeName}" carries ${shapeFields.map((f) => `"${f}"`).join(", ")}`,
          { kind: "shape", fields: shapeFields }
        ),
        rationale: `These fields were present and non-null on ${Math.round(ubiquitous[0].presentIn / allItems.length * 100)}% or more of ${allItems.length} captured items. A field that silently stops arriving is one of the commonest causes of downstream rows that look filled in and are not.`,
        confidence: allItems.length >= 100 ? "high" : "moderate",
        derivedFrom: { kind: "observation", runIds, sampleSize: allItems.length }
      });
    }
    const textFields = stats.filter((s) => s.stringIn > 0 && s.stringIn / Math.max(1, s.presentIn) > 0.8 && s.meanLength >= 15).slice(0, 6).map((s) => s.field);
    if (textFields.length > 0) {
      const patterns = ["empty-string", "unrendered-template", "error-text-in-value", "null-literal"];
      if (sink.category === "ai-generation" || sink.category === "email" || sink.category === "messaging") {
        patterns.push("model-refusal");
      }
      out.push({
        assertion: makeAssertion(
          workflowId,
          sink.nodeId,
          "observation",
          `Text from "${sink.nodeName}" is never empty, unrendered or an error string`,
          { kind: "not-degenerate", fields: textFields, patterns }
        ),
        rationale: `${textFields.length} field(s) here carry prose averaging ${Math.round(stats.find((s) => s.field === textFields[0])?.meanLength ?? 0)} characters. Those are the fields where "[object Object]", an unresolved "{{ }}" or a model refusal will pass through unnoticed.`,
        confidence: "moderate",
        derivedFrom: { kind: "observation", runIds, sampleSize: allItems.length }
      });
    }
  }
  const profile = inferCadence(successful);
  if (profile) {
    const expect = profile.p95IntervalSeconds;
    const grace = Math.max(profile.medianIntervalSeconds, Math.round(expect * 0.5));
    out.push({
      assertion: makeAssertion(
        workflowId,
        "*",
        "observation",
        `This workflow runs at least every ${humaniseSeconds(expect)}`,
        { kind: "cadence", expectEverySeconds: expect, graceSeconds: grace }
      ),
      rationale: `${profile.reasoning} A workflow that stops firing writes no execution and raises no error, so without this check its disappearance is invisible.`,
      confidence: profile.confidence,
      derivedFrom: { kind: "observation", runIds, sampleSize: profile.sampleSize }
    });
  }
  return out;
}
function humaniseSeconds(s) {
  if (s < 90) return `${Math.round(s)} seconds`;
  if (s < 5400) return `${Math.round(s / 60)} minutes`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} hours`;
  return `${(s / 86400).toFixed(1)} days`;
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
function hashEntry(e) {
  const material = [
    String(e.seq),
    e.at,
    e.kind,
    e.workflowId,
    e.clientId ?? "",
    canonical(e.payload),
    e.prevHash
  ].join("\0");
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

// src/connect/n8n.ts
var N8nError = class extends Error {
  constructor(message, status, hint) {
    super(message);
    this.status = status;
    this.hint = hint;
    this.name = "N8nError";
  }
};
var N8nClient = class {
  baseUrl;
  apiKey;
  f;
  timeoutMs;
  constructor(opts) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.f = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 3e4;
  }
  async get(path, params = {}) {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== void 0) url.searchParams.set(k, String(v));
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res;
    try {
      res = await this.f(url.toString(), {
        method: "GET",
        headers: { "X-N8N-API-KEY": this.apiKey, accept: "application/json" },
        signal: ac.signal
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/abort/i.test(msg)) {
        throw new N8nError(`n8n did not respond within ${this.timeoutMs / 1e3}s`, void 0, "Check the base URL is reachable from this machine.");
      }
      throw new N8nError(`Could not reach n8n at ${this.baseUrl}: ${msg}`, void 0, "Include the scheme, for example https://n8n.example.com, and no trailing /api/v1.");
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 401) {
      throw new N8nError("n8n rejected the API key (401).", 401, "Create a key under Settings, n8n API. On n8n Cloud the base URL is https://<tenant>.app.n8n.cloud.");
    }
    if (res.status === 404) {
      throw new N8nError(`n8n returned 404 for ${path}.`, 404, "The public API is disabled on some self-hosted setups; set N8N_PUBLIC_API_DISABLED=false.");
    }
    if (!res.ok) {
      throw new N8nError(`n8n returned ${res.status} for ${path}.`, res.status);
    }
    return await res.json();
  }
  /** Every workflow the key can see, with its semantic revision hash. */
  async listWorkflows() {
    const out = [];
    let cursor;
    do {
      const page = await this.get(
        "/workflows",
        { limit: 100, cursor }
      );
      for (const wf of page.data ?? []) {
        if (!wf.id) continue;
        out.push({
          id: String(wf.id),
          platform: "n8n",
          name: wf.name ?? "(unnamed)",
          active: wf.active === true,
          hash: workflowHash(wf)
        });
      }
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  }
  async getWorkflow(id) {
    return this.get(`/workflows/${encodeURIComponent(id)}`);
  }
  /**
   * Recent executions for one workflow.
   *
   * `includeData` is expensive and is the only way to see what a run actually
   * produced, so it is opt-in: cadence work needs only timestamps, while
   * verification needs the payloads.
   */
  async listRuns(workflowId, opts = {}) {
    const limit = opts.limit ?? 50;
    const includeData = opts.includeData ?? false;
    const doc = await this.getWorkflow(workflowId);
    const nameToId = /* @__PURE__ */ new Map();
    for (const n of doc.nodes ?? []) nameToId.set(n.name, n.id && n.id.trim() ? n.id : `name:${n.name}`);
    const triggerNames = new Set(
      (doc.nodes ?? []).filter((n) => /trigger|webhook/i.test(n.type)).map((n) => n.name)
    );
    const runs = [];
    let cursor;
    while (runs.length < limit) {
      const page = await this.get("/executions", {
        workflowId,
        limit: Math.min(100, limit - runs.length),
        includeData,
        cursor
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
  async getRun(executionId, workflowId) {
    const doc = await this.getWorkflow(workflowId);
    const nameToId = /* @__PURE__ */ new Map();
    for (const n of doc.nodes ?? []) nameToId.set(n.name, n.id && n.id.trim() ? n.id : `name:${n.name}`);
    const triggerNames = new Set((doc.nodes ?? []).filter((n) => /trigger|webhook/i.test(n.type)).map((n) => n.name));
    const raw = await this.get(`/executions/${encodeURIComponent(executionId)}`, { includeData: true });
    return this.normaliseRun(raw, workflowId, nameToId, triggerNames);
  }
  normaliseRun(raw, workflowId, nameToId, triggerNames) {
    const runData = raw.data?.resultData?.runData ?? {};
    const sinkOutputs = {};
    let triggerInput;
    for (const [nodeName, taskRuns] of Object.entries(runData)) {
      const items = [];
      for (const task of taskRuns ?? []) {
        for (const branch of task.data?.main ?? []) {
          for (const item of branch ?? []) {
            items.push(item?.json ?? null);
          }
        }
      }
      const id = nameToId.get(nodeName);
      sinkOutputs[id ?? `unresolved:${nodeName}`] = items;
      if (triggerNames.has(nodeName)) triggerInput = items;
    }
    return {
      id: String(raw.id),
      workflowId: raw.workflowId ? String(raw.workflowId) : workflowId,
      platform: "n8n",
      startedAt: raw.startedAt ?? (/* @__PURE__ */ new Date(0)).toISOString(),
      finishedAt: raw.stoppedAt,
      platformStatus: mapStatus(raw),
      sinkOutputs,
      triggerInput
    };
  }
};
function mapStatus(raw) {
  const s = (raw.status ?? "").toLowerCase();
  if (s === "success") return "success";
  if (s === "error" || s === "crashed" || s === "failed") return "error";
  if (s === "running" || s === "new") return "running";
  if (s === "waiting") return "waiting";
  if (raw.finished === true) return "success";
  return "unknown";
}

// src/report/render.ts
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function date(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
function dateTime(iso) {
  return new Date(iso).toISOString().slice(0, 16).replace("T", " ");
}
var UNPROVEN_EXPLANATIONS = {
  "no-assertions": "no expectation has been written for this step",
  "only-proposed-assertions": "an expectation exists but nobody has confirmed it, so it cannot raise anything",
  "contract-stale": "the workflow changed after this expectation was confirmed, so it no longer describes what runs",
  "sink-not-captured": "the platform did not retain this step&rsquo;s output for the run, so there was nothing to check against",
  "run-data-unavailable": "the run data needed for this check was not available",
  "assertion-not-applicable": "this expectation does not apply to this kind of run"
};
function group(violations) {
  const map = /* @__PURE__ */ new Map();
  for (const v of violations) {
    const prev = map.get(v.result.assertionId);
    if (!prev) {
      map.set(v.result.assertionId, {
        assertionId: v.result.assertionId,
        statement: v.result.statement,
        basis: v.result.basis,
        count: 1,
        firstAt: v.at,
        lastAt: v.at,
        detail: v.result.detail,
        evidence: v.result.evidence
      });
    } else {
      map.set(v.result.assertionId, { ...prev, count: prev.count + 1, lastAt: v.at ?? prev.lastAt });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
function basisNote(basis) {
  switch (basis) {
    case "intent":
      return "stated business intent";
    case "structure":
      return "the workflow&rsquo;s own definition";
    case "observation":
      return "observed history, attested as a good baseline";
    default:
      return basis;
  }
}
function renderReport(input) {
  const { result, ledger, platform } = input;
  const violations = group(result.violations);
  const chain = ledger.verify();
  const unprovenRows = Object.entries(result.unprovenBreakdown).sort((a, b) => b[1] - a[1]);
  const totalChecks = result.counts.proven + result.counts.violated + result.counts.unproven;
  const confirmedByBasis = result.honesty.byBasis;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verification record: ${esc(input.clientName)}</title>
<style>
  :root {
    --ink: #16191d;
    --ink-soft: #4d545c;
    --rule: #d9dde2;
    --rule-soft: #eceff2;
    --paper: #ffffff;
    --shell: #f6f7f9;
    --violated: #9d1f27;
    --violated-bg: #fdf2f2;
    --unproven: #7d5200;
    --unproven-bg: #fdf8ec;
    --proven: #1c6141;
    --proven-bg: #f1f8f4;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--shell);
    color: var(--ink);
    font: 15px/1.6 ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .sheet { max-width: 860px; margin: 0 auto; background: var(--paper); padding: 56px 60px 72px; }
  h1 { font-size: 27px; line-height: 1.25; margin: 0 0 6px; letter-spacing: -0.01em; font-weight: 620; }
  h2 { font-size: 18px; margin: 44px 0 14px; font-weight: 620; letter-spacing: -0.005em; }
  h3 { font-size: 15px; margin: 0 0 4px; font-weight: 620; }
  p { margin: 0 0 12px; max-width: 68ch; }
  .meta { color: var(--ink-soft); font-size: 13.5px; margin-bottom: 26px; }
  .meta span + span::before { content: " / "; color: var(--rule); }
  .lede {
    font-size: 17px; line-height: 1.5; margin: 0 0 8px;
    border-left: 3px solid var(--ink); padding-left: 16px;
  }
  .counts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--rule); border: 1px solid var(--rule); margin: 26px 0 8px; }
  .count { background: var(--paper); padding: 16px 18px; }
  .count b { display: block; font-size: 30px; line-height: 1.1; font-weight: 620; }
  .count small { color: var(--ink-soft); font-size: 13px; }
  .count.violated b { color: var(--violated); }
  .count.unproven b { color: var(--unproven); }
  .count.proven b { color: var(--proven); }
  .finding { border: 1px solid var(--rule); border-left: 3px solid var(--violated); background: var(--violated-bg); padding: 16px 18px; margin: 0 0 12px; }
  .finding .where { color: var(--ink-soft); font-size: 13.5px; margin: 2px 0 8px; }
  .evidence { background: var(--paper); border: 1px solid var(--rule); padding: 10px 12px; margin-top: 10px;
    font: 13px/1.5 ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
  .evidence-label { font-size: 12.5px; color: var(--ink-soft); margin-bottom: 4px; }
  .gap { border: 1px solid var(--rule); border-left: 3px solid var(--unproven); background: var(--unproven-bg); padding: 14px 18px; margin: 0 0 10px; }
  .ok { border: 1px solid var(--rule); border-left: 3px solid var(--proven); background: var(--proven-bg); padding: 14px 18px; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
  th { font-weight: 620; border-bottom: 1px solid var(--rule); }
  td.num, th.num { text-align: right; width: 6em; }
  .note { color: var(--ink-soft); font-size: 13.5px; }
  footer { margin-top: 48px; padding-top: 20px; border-top: 1px solid var(--rule); color: var(--ink-soft); font-size: 13px; }
  code { font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--rule-soft); padding: 1px 4px; }
  @media (max-width: 720px) {
    .sheet { padding: 32px 22px 48px; }
    .counts { grid-template-columns: 1fr; }
  }
  @media print {
    body { background: #fff; }
    .sheet { padding: 0; max-width: none; }
  }
</style>
</head>
<body>
<div class="sheet">

  <h1>Verification record</h1>
  <p class="meta">
    <span>${esc(input.clientName)}</span>
    <span>${esc(result.workflowName)}</span>
    <span>${date(input.periodStart)} to ${date(input.periodEnd)}</span>
    <span>prepared by ${esc(input.preparedBy)}</span>
  </p>

  <p class="lede">${esc(result.headline)}</p>

  <p class="note">
    Over the same period the automation platform recorded ${platform.executions} executions,
    ${platform.succeeded} of them successful and ${platform.failed} failed. That count answers
    whether the code ran. It does not answer whether the work happened, which is what
    the rest of this document is about.
  </p>

  <div class="counts">
    <div class="count violated"><b>${result.counts.violated}</b><small>checks violated</small></div>
    <div class="count unproven"><b>${result.counts.unproven}</b><small>could not be established</small></div>
    <div class="count proven"><b>${result.counts.proven}</b><small>checks held</small></div>
  </div>
  <p class="note">${totalChecks} check evaluations across ${result.runsExamined} runs.</p>

  <h2>What this month&rsquo;s checks can and cannot prove</h2>
  <p>${esc(result.honesty.sentence)}</p>
  <table>
    <thead><tr><th>Basis of the expectation</th><th class="num">Live</th><th>What a green result means</th></tr></thead>
    <tbody>
      <tr><td>Stated business intent</td><td class="num">${confirmedByBasis.intent}</td><td>The workflow is doing the job somebody said it was for.</td></tr>
      <tr><td>The workflow&rsquo;s own definition</td><td class="num">${confirmedByBasis.structure}</td><td>The workflow is doing what its definition says. Whether the definition is right is a separate question.</td></tr>
      <tr><td>Observed history, with an attested baseline</td><td class="num">${confirmedByBasis.observation}</td><td>Behaviour has not changed since a period a named person confirmed was correct.</td></tr>
    </tbody>
  </table>

  ${violations.length > 0 ? `<h2>What was caught (${violations.length})</h2>
  ${violations.map(
    (v) => `<div class="finding">
    <h3>${esc(v.statement)}</h3>
    <p class="where">${v.count} run${v.count === 1 ? "" : "s"}${v.firstAt ? `, first at ${esc(dateTime(v.firstAt))}` : ""}${v.lastAt && v.lastAt !== v.firstAt ? `, most recently ${esc(dateTime(v.lastAt))}` : ""} &middot; expectation derived from ${basisNote(v.basis)}</p>
    ${v.detail ? `<p>${esc(v.detail)}</p>` : ""}
    ${v.evidence ? `<div class="evidence-label">Captured value that decided it</div><div class="evidence">${esc(v.evidence)}</div>` : ""}
  </div>`
  ).join("\n  ")}` : `<h2>What was caught</h2>
  <div class="ok"><h3>No confirmed expectation was violated in this period.</h3>
  <p class="note">That is a statement about the ${result.counts.proven} checks that ran, and nothing more. The section below lists what was not established.</p></div>`}

  ${unprovenRows.length > 0 ? `<h2>What could not be established</h2>
  <p>These are not passes and they are not failures. They are the parts of this workflow
  that nothing verified, listed so that the coverage above is not mistaken for the whole picture.</p>
  ${unprovenRows.map(
    ([reason, count]) => `<div class="gap"><h3>${count} check${count === 1 ? "" : "s"}: ${UNPROVEN_EXPLANATIONS[reason] ?? esc(reason)}</h3></div>`
  ).join("\n  ")}` : ""}

  ${result.drift.length > 0 ? `<h2>Changes to the workflow in this period</h2>
  <p>Each of these invalidated any expectation confirmed against the previous revision,
  which is why some checks above read as unproven rather than continuing to report a
  result about a graph that no longer exists.</p>
  <ul>${result.drift.map((d) => `<li>${esc(d.description)}</li>`).join("")}</ul>` : ""}

  <h2>Record integrity</h2>
  <p>
    ${ledger.length} entries recorded in this period&rsquo;s evidence log, covering every
    expectation confirmed, who confirmed it, and every violation raised.
    ${chain.ok ? "Each entry commits to the one before it, and the chain recomputes correctly, so no entry has been edited, backdated or removed since it was written." : `<strong>The chain does not verify: ${esc(chain.brokenAt !== void 0 ? chain.reason : "unknown")}</strong> This report should not be relied on until that is explained.`}
  </p>
  <p class="note">
    This is a hash chain in a file held by whoever produced the report. It makes accidental
    corruption and casual editing detectable. It is not a claim against a determined operator
    who controls the file, and it is not presented as one.
  </p>

  <footer>
    Produced by silentgreen. Every figure above is derived from execution data captured
    from the automation platform, and every violation quotes the literal value that decided it.
    Checks that could not be evaluated are reported as unproven rather than counted as passes.
  </footer>

</div>
</body>
</html>`;
}

// src/store/store.ts
import { existsSync as existsSync2, mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
var STORE_DIR = ".silentgreen";
var STATE_FILE = "state.json";
var LEDGER_FILE = "ledger.jsonl";
var STATE_VERSION = 1;
var SAMPLES_PER_SINK = 4;
function emptyState() {
  return { version: STATE_VERSION, workflows: {}, assertions: [], clients: {}, alerts: {} };
}
var Store = class {
  constructor(dir = STORE_DIR) {
    this.dir = dir;
    mkdirSync2(dir, { recursive: true });
    const path = join(dir, STATE_FILE);
    if (existsSync2(path)) {
      try {
        this.state = JSON.parse(readFileSync2(path, "utf8"));
      } catch (err) {
        throw new Error(
          `${path} could not be parsed, so the confirmed expectations cannot be read. Move it aside and rescan rather than continuing, because a store that half-loads is worse than none. (${String(err)})`
        );
      }
      if (!this.state.alerts) this.state.alerts = {};
      if (this.state.version !== STATE_VERSION) {
        throw new Error(`${path} was written by a different version of this tool (found ${this.state.version}, expected ${STATE_VERSION}).`);
      }
    } else {
      this.state = emptyState();
    }
    this.ledger = new Ledger(join(dir, LEDGER_FILE));
  }
  state;
  ledger;
  save() {
    const finalPath = join(this.dir, STATE_FILE);
    const tmp = `${finalPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), "utf8");
    renameSync(tmp, finalPath);
  }
  workflows() {
    return Object.values(this.state.workflows);
  }
  workflow(id) {
    return this.state.workflows[id];
  }
  assertions(workflowId) {
    return workflowId ? this.state.assertions.filter((a) => a.workflowId === workflowId) : this.state.assertions;
  }
  assertion(id) {
    return this.state.assertions.find((a) => a.id === id);
  }
  alerts() {
    return this.state.alerts;
  }
  setAlerts(next) {
    this.state.alerts = { ...next };
  }
  clients() {
    return this.state.clients;
  }
  setClient(workflowId, clientId, clientName) {
    const wf = this.state.workflows[workflowId];
    if (!wf) return;
    wf.clientId = clientId;
    if (!this.state.clients[clientId]) this.state.clients[clientId] = { name: clientName ?? clientId };
    else if (clientName) this.state.clients[clientId].name = clientName;
  }
  /**
   * Record a workflow as it is right now.
   *
   * If the graph has changed since the last scan, every confirmed expectation
   * bound to the old revision becomes stale, the change is written to the ledger
   * with a human-readable description, and those checks start reporting
   * `unproven` rather than continuing to describe a graph that no longer exists.
   */
  observeWorkflow(args) {
    const existing = this.state.workflows[args.id];
    let changes = [];
    let staled = 0;
    if (existing && existing.hash !== args.hash) {
      changes = diffWorkflows(existing.doc, args.doc);
      const now = (/* @__PURE__ */ new Date()).toISOString();
      for (const a of this.state.assertions) {
        if (a.workflowId !== args.id) continue;
        if (a.status !== "confirmed") continue;
        const idx = this.state.assertions.indexOf(a);
        this.state.assertions[idx] = {
          ...a,
          status: "stale",
          stale: { since: now, fromHash: existing.hash, toHash: args.hash }
        };
        staled += 1;
      }
      this.ledger.append(
        "contract-stale",
        args.id,
        {
          fromHash: existing.hash,
          toHash: args.hash,
          staledAssertions: staled,
          changes: changes.map((c2) => c2.description)
        },
        { clientId: existing.clientId }
      );
    }
    const samples = {};
    const sampleRunIds = [];
    for (const run of args.runs.slice(0, 12)) {
      let used = false;
      for (const [sinkId, items] of Object.entries(run.sinkOutputs)) {
        const bucket = samples[sinkId] ?? (samples[sinkId] = []);
        if (bucket.length >= SAMPLES_PER_SINK) continue;
        if (items.length === 0) continue;
        bucket.push(items[0]);
        used = true;
      }
      if (used) sampleRunIds.push(run.id);
    }
    const times = args.runs.map((r) => Date.parse(r.startedAt)).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
    const observedWindow = times.length > 0 ? { start: new Date(times[0]).toISOString(), end: new Date(times[times.length - 1]).toISOString() } : existing?.observedWindow;
    this.state.workflows[args.id] = {
      id: args.id,
      platform: args.platform,
      name: args.name,
      active: args.active,
      hash: args.hash,
      doc: args.doc,
      previousDoc: existing && existing.hash !== args.hash ? existing.doc : existing?.previousDoc,
      previousHash: existing && existing.hash !== args.hash ? existing.hash : existing?.previousHash,
      clientId: existing?.clientId,
      lastScannedAt: (/* @__PURE__ */ new Date()).toISOString(),
      cadenceShape: args.cadenceShape ?? existing?.cadenceShape,
      samples,
      sampleRunIds,
      observedWindow
    };
    if (!existing) {
      this.ledger.append("workflow-observed", args.id, { name: args.name, hash: args.hash, active: args.active });
    }
    return { changes, staled };
  }
  /**
   * Add proposals, skipping any that duplicate an expectation already on file.
   *
   * A scan that re-proposes the same forty checks every night would train people
   * to clear the queue without reading it, which defeats the only mechanism that
   * makes any of this mean anything.
   */
  addProposals(proposals) {
    let added = 0;
    let skipped = 0;
    for (const p of proposals) {
      const dup = this.state.assertions.some(
        (a) => a.workflowId === p.assertion.workflowId && a.sinkId === p.assertion.sinkId && a.kind === p.assertion.kind && a.basis === p.assertion.basis && a.status !== "retired"
      );
      if (dup) {
        skipped += 1;
        continue;
      }
      this.state.assertions.push({ ...p.assertion, rationale: p.rationale, confidence: p.confidence });
      added += 1;
    }
    if (added > 0) {
      const wfId = proposals[0]?.assertion.workflowId ?? "";
      this.ledger.append("proposal-made", wfId, { added, skipped }, { clientId: this.state.workflows[wfId]?.clientId });
    }
    return { added, skipped };
  }
  /** Put a proposal through the gate. Refusals are recorded too. */
  confirm(assertionId, confirmation) {
    const idx = this.state.assertions.findIndex((a2) => a2.id === assertionId);
    if (idx < 0) return { ok: false, refusal: { reason: "retired", message: "That expectation is not in the store." } };
    const a = this.state.assertions[idx];
    const wf = this.state.workflows[a.workflowId];
    const result = confirmAssertion(a, confirmation, { currentWorkflowHash: wf?.hash ?? "" });
    if ("refused" in result) {
      this.ledger.append(
        "assertion-refused",
        a.workflowId,
        { assertionId, statement: a.statement, reason: result.refused.reason, by: confirmation.by },
        { clientId: wf?.clientId }
      );
      return { ok: false, refusal: result.refused };
    }
    this.state.assertions[idx] = result.assertion;
    this.ledger.append(
      "assertion-confirmed",
      a.workflowId,
      {
        assertionId,
        statement: a.statement,
        basis: a.basis,
        by: confirmation.by,
        workflowHash: confirmation.workflowHash,
        evidenceRunIds: confirmation.evidenceRunIds,
        // The attestation is recorded verbatim, because it is printed beside
        // every green tick it goes on to produce.
        baselineAttestation: confirmation.baselineAttestation
      },
      { clientId: wf?.clientId }
    );
    return { ok: true };
  }
  retire(assertionId, by, why) {
    const idx = this.state.assertions.findIndex((a2) => a2.id === assertionId);
    if (idx < 0) return false;
    const a = this.state.assertions[idx];
    this.state.assertions[idx] = { ...a, status: "retired" };
    this.ledger.append(
      "assertion-retired",
      a.workflowId,
      { assertionId, statement: a.statement, by, why },
      { clientId: this.state.workflows[a.workflowId]?.clientId }
    );
    return true;
  }
  counts(workflowId) {
    const list = this.assertions(workflowId);
    return {
      proposed: list.filter((a) => a.status === "proposed").length,
      confirmed: list.filter((a) => a.status === "confirmed").length,
      stale: list.filter((a) => a.status === "stale").length,
      retired: list.filter((a) => a.status === "retired").length
    };
  }
};

// src/serve/server.ts
import { createServer } from "node:http";

// src/serve/app.ts
var APP_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>silentgreen review</title>
<style>
  :root {
    --ground: #eef1f4; --panel: #fff; --ink: #10151a; --soft: #4e5761; --faint: #79838d;
    --rule: #d5dbe1; --rule-soft: #e8ecf0;
    --intent: #1c4ea8; --intent-bg: #eef3fb;
    --structure: #475059; --structure-bg: #eef0f2;
    --observation: #7d5200; --observation-bg: #fcf7ea;
    --ok: #157f47; --ok-bg: #eef7f2;
    --bad: #a4231b; --bad-bg: #fcf1f0;
    --sans: ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--ground); color: var(--ink); font: 400 15px/1.55 var(--sans); font-variant-numeric: tabular-nums; }
  button { font: inherit; }

  header {
    background: var(--ink); color: #e8ecf0; padding: 10px 18px;
    display: flex; align-items: center; gap: 18px; flex-wrap: wrap;
  }
  header .mark { font-weight: 700; letter-spacing: -0.02em; }
  header .mark i { font-style: normal; color: #4fbe84; }
  header .meta { color: #98a4ae; font-size: 13px; }
  header .who { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 13px; color: #98a4ae; }
  header .who input {
    font: 400 13px var(--sans); padding: 5px 9px; border: 1px solid #39424c;
    background: #1b2229; color: #e8ecf0; min-width: 210px;
  }
  header .who input::placeholder { color: #6d7882; }

  .layout { display: grid; grid-template-columns: 288px 1fr; min-height: calc(100vh - 42px); }
  aside { background: var(--panel); border-right: 1px solid var(--rule); }
  aside h2 { font-size: 12.5px; font-weight: 600; color: var(--faint); margin: 0; padding: 14px 16px 8px; }
  .wf { display: block; width: 100%; text-align: left; background: transparent; border: 0; border-bottom: 1px solid var(--rule-soft); padding: 12px 16px; cursor: pointer; }
  .wf:hover { background: var(--ground); }
  .wf[aria-current="true"] { background: var(--ink); color: #fff; }
  .wf .n { font-weight: 600; font-size: 14.5px; }
  .wf .c { font-size: 12.5px; color: var(--faint); margin-top: 3px; }
  .wf[aria-current="true"] .c { color: #9fb0bd; }
  .pill { display: inline-block; padding: 1px 6px; font-size: 11.5px; border: 1px solid currentColor; margin-right: 5px; }

  main { padding: 22px 26px 60px; max-width: 900px; }
  h1 { font-size: 22px; letter-spacing: -0.02em; margin: 0 0 3px; }
  .sub { color: var(--soft); font-size: 14px; margin: 0 0 18px; }

  .tabs { display: flex; border-bottom: 1px solid var(--rule); margin-bottom: 20px; }
  .tabs button { background: transparent; border: 0; border-bottom: 2px solid transparent; padding: 9px 14px; cursor: pointer; color: var(--soft); font-weight: 500; font-size: 14px; }
  .tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--ink); }

  .honesty { background: var(--panel); border: 1px solid var(--rule); border-left: 3px solid var(--observation); padding: 13px 16px; margin-bottom: 18px; font-size: 14.5px; }

  .card { background: var(--panel); border: 1px solid var(--rule); margin-bottom: 14px; }
  .card-head { padding: 16px 18px 0; }
  .chip { display: inline-block; font-size: 11.5px; font-weight: 600; padding: 2px 7px; letter-spacing: .02em; margin-bottom: 8px; }
  .chip.intent { background: var(--intent-bg); color: var(--intent); }
  .chip.structure { background: var(--structure-bg); color: var(--structure); }
  .chip.observation { background: var(--observation-bg); color: var(--observation); }
  .chip.conf { background: var(--ok-bg); color: var(--ok); }
  .chip.stale { background: var(--observation-bg); color: var(--observation); }
  .card h3 { margin: 0 0 6px; font-size: 16.5px; font-weight: 600; line-height: 1.35; }
  .card .why { color: var(--soft); font-size: 14.5px; margin: 0 0 12px; }
  .card .sink { color: var(--faint); font-size: 13px; margin: 0 0 10px; }

  .proves { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--rule-soft); border-top: 1px solid var(--rule-soft); border-bottom: 1px solid var(--rule-soft); }
  .proves div { background: var(--panel); padding: 11px 18px; font-size: 13.5px; }
  .proves .k { display: block; font-weight: 600; color: var(--faint); font-size: 12px; margin-bottom: 2px; }
  .proves .yes { border-left: 3px solid var(--ok); }
  .proves .no { border-left: 3px solid var(--observation); }

  .evidence { padding: 14px 18px; }
  .evidence .k { font-size: 12.5px; color: var(--faint); margin-bottom: 6px; }
  .evidence pre { margin: 0; padding: 10px 12px; background: var(--ground); border: 1px solid var(--rule-soft); font: 400 12.5px/1.6 var(--mono); overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 190px; }

  .attest { padding: 0 18px 4px; }
  .attest .box { background: var(--observation-bg); border: 1px solid var(--rule); border-left: 3px solid var(--observation); padding: 14px 16px; }
  .attest label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; }
  .attest .dates { display: flex; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .attest input[type=date], .attest textarea, .attest input[type=text] {
    font: 400 14px var(--sans); padding: 7px 9px; border: 1px solid var(--rule); background: var(--panel); color: var(--ink); width: 100%;
  }
  .attest .dates > div { flex: 1 1 150px; }
  .attest textarea { min-height: 62px; resize: vertical; }
  .attest .verdict { font-size: 13px; margin-top: 7px; min-height: 18px; }
  .attest .verdict.no { color: var(--bad); }
  .attest .verdict.yes { color: var(--ok); }

  .actions { padding: 14px 18px 16px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .btn { border: 1px solid var(--ink); background: var(--ink); color: #fff; padding: 8px 15px; cursor: pointer; font-weight: 500; font-size: 14px; }
  .btn.ghost { background: transparent; color: var(--soft); border-color: var(--rule); }
  .btn:disabled { opacity: .45; cursor: not-allowed; }
  .btn:focus-visible, .wf:focus-visible, .tabs button:focus-visible { outline: 2px solid var(--intent); outline-offset: 2px; }

  .refusal { margin: 0 18px 16px; background: var(--bad-bg); border: 1px solid var(--rule); border-left: 3px solid var(--bad); padding: 12px 15px; font-size: 14px; }
  .refusal[hidden] { display: none; }

  .empty { background: var(--panel); border: 1px solid var(--rule); padding: 30px 24px; color: var(--soft); }
  .empty b { color: var(--ink); }

  table.led { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--rule); font-size: 13.5px; }
  table.led th, table.led td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--rule-soft); vertical-align: top; }
  table.led th { font-weight: 600; color: var(--faint); font-size: 12.5px; }
  table.led td.k { font-family: var(--mono); font-size: 12px; color: var(--soft); white-space: nowrap; }
  .chainok { font-size: 13.5px; margin-bottom: 12px; }
  .chainok.ok { color: var(--ok); }
  .chainok.bad { color: var(--bad); }
</style>
</head>
<body>

<header>
  <div class="mark">silent<i>green</i></div>
  <div class="meta" id="hmeta">reading store</div>
  <div class="who">
    <label for="who">confirming as</label>
    <input id="who" type="text" placeholder="your name or email" autocomplete="email">
  </div>
</header>

<div class="layout">
  <aside>
    <h2>Workflows</h2>
    <div id="wflist"></div>
  </aside>
  <main>
    <h1 id="title">&nbsp;</h1>
    <p class="sub" id="subtitle">&nbsp;</p>
    <div class="honesty" id="honesty"></div>
    <div class="tabs" role="tablist">
      <button role="tab" data-tab="queue" aria-selected="true">Review queue</button>
      <button role="tab" data-tab="live" aria-selected="false">Live checks</button>
      <button role="tab" data-tab="stale" aria-selected="false">Stale</button>
      <button role="tab" data-tab="history" aria-selected="false">History</button>
    </div>
    <div id="body"></div>
  </main>
</div>

<script>
(function () {
  var S = null, current = null, tab = 'queue';
  var whoEl = document.getElementById('who');
  whoEl.value = localStorage.getItem('sg.who') || '';
  whoEl.addEventListener('input', function () { localStorage.setItem('sg.who', whoEl.value); render(); });

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function api(path, body) {
    return fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)
      .then(function (r) { return r.json(); });
  }
  function load() {
    return api('/api/state').then(function (s) {
      S = s;
      if (!current || !S.workflows.some(function (w) { return w.id === current; })) {
        current = S.workflows.length ? S.workflows[0].id : null;
      }
      render();
    });
  }

  function wf() { return S.workflows.filter(function (w) { return w.id === current; })[0]; }
  function forWf(status) {
    return S.assertions.filter(function (a) { return a.workflowId === current && (status ? a.status === status : true); });
  }

  function renderSidebar() {
    var el = document.getElementById('wflist');
    if (!S.workflows.length) { el.innerHTML = '<div style="padding:16px;color:var(--faint);font-size:13.5px">Nothing scanned yet.</div>'; return; }
    el.innerHTML = S.workflows.map(function (w) {
      var c = w.counts;
      return '<button class="wf" data-id="' + esc(w.id) + '" aria-current="' + (w.id === current) + '">' +
        '<div class="n">' + esc(w.name) + '</div>' +
        '<div class="c">' + c.proposed + ' to review · ' + c.confirmed + ' live' + (c.stale ? ' · ' + c.stale + ' stale' : '') + '</div>' +
        '</button>';
    }).join('');
    Array.prototype.forEach.call(el.querySelectorAll('.wf'), function (b) {
      b.addEventListener('click', function () { current = b.dataset.id; render(); });
    });
  }

  function proposalCard(a, w) {
    var sink = (w.sinkNames && w.sinkNames[a.sinkId]) || a.sinkId;
    var samples = (w.samples && w.samples[a.sinkId]) || [];
    var evid = samples.length
      ? '<div class="evidence"><div class="k">Real values this will be judging, captured from ' + esc(w.sampleRunIds.length) + ' recent run(s)</div><pre>' +
        esc(samples.map(function (s) { return JSON.stringify(s, null, 2); }).join('\n\n')) + '</pre></div>'
      : '<div class="evidence"><div class="k">No captured output was retained for this step, so there is nothing to show you. Confirming without seeing what it judges is exactly the habit this screen exists to interrupt.</div></div>';

    // Prefill the window this was actually learned from. The reviewer is being
    // asked whether that period was good, so making them look it up first is
    // friction that teaches people to click past the only question that matters.
    var win = w.observedWindow || {};
    var ds = (win.start || '').slice(0, 10);
    var de = (win.end || '').slice(0, 10);

    var attest = a.needsAttestation
      ? '<div class="attest"><div class="box">' +
          '<label>This expectation was learned from what the workflow has been doing between ' +
            esc(ds || 'an unknown date') + ' and ' + esc(de || 'an unknown date') +
            '. On its own that proves only that it has not changed. Do you believe that period was actually correct?</label>' +
          '<div class="dates">' +
            '<div><label for="ws-' + a.id + '">from</label><input type="date" id="ws-' + a.id + '" value="' + esc(ds) + '"></div>' +
            '<div><label for="we-' + a.id + '">to</label><input type="date" id="we-' + a.id + '" value="' + esc(de) + '"></div>' +
          '</div>' +
          '<label for="hk-' + a.id + '">and how do you know it was correct?</label>' +
          '<textarea id="hk-' + a.id + '" placeholder="Reconciled against the client invoice export for August"></textarea>' +
          '<div class="verdict" id="v-' + a.id + '"></div>' +
        '</div></div>'
      : '';

    return '<div class="card" data-a="' + a.id + '">' +
      '<div class="card-head">' +
        '<span class="chip ' + a.basis + '">' + a.basis + '</span>' +
        '<h3>' + esc(a.statement) + '</h3>' +
        '<p class="sink">at ' + esc(sink) + ' · ' + esc(a.kind) + ' · confidence ' + esc(a.confidence) + '</p>' +
        '<p class="why">' + esc(a.rationale) + '</p>' +
      '</div>' +
      '<div class="proves">' +
        '<div class="yes"><span class="k">A green result here proves</span>' + esc(a.proves) + '</div>' +
        '<div class="no"><span class="k">It does not prove</span>' + esc(a.doesNotProve) + '</div>' +
      '</div>' +
      evid + attest +
      '<div class="refusal" id="r-' + a.id + '" hidden></div>' +
      '<div class="actions">' +
        '<button class="btn" data-confirm="' + a.id + '">Confirm this expectation</button>' +
        '<button class="btn ghost" data-retire="' + a.id + '">Not this one</button>' +
      '</div>' +
    '</div>';
  }

  function renderQueue() {
    var w = wf(), list = forWf('proposed');
    if (!list.length) {
      return '<div class="empty"><b>Nothing waiting.</b><br>Run <code>silentgreen scan</code> to look for new expectations, or check the live tab for what is already running.</div>';
    }
    return list.map(function (a) { return proposalCard(a, w); }).join('');
  }

  function renderLive() {
    var list = forWf('confirmed'), w = wf();
    if (!list.length) return '<div class="empty"><b>No live checks.</b><br>Until something here is confirmed, every verdict on this workflow reads as unproven, which is the honest answer rather than a failure.</div>';
    return list.map(function (a) {
      var sink = (w.sinkNames && w.sinkNames[a.sinkId]) || a.sinkId;
      return '<div class="card"><div class="card-head">' +
        '<span class="chip conf">live</span> <span class="chip ' + a.basis + '">' + a.basis + '</span>' +
        '<h3>' + esc(a.statement) + '</h3>' +
        '<p class="sink">at ' + esc(sink) + ' · confirmed by ' + esc(a.confirmation ? a.confirmation.by : '?') +
          ' on ' + esc(a.confirmation ? a.confirmation.at.slice(0, 10) : '') + '</p>' +
        (a.confirmation && a.confirmation.attestation
          ? '<p class="why"><strong>Baseline attested:</strong> ' + esc(a.confirmation.attestation) + '</p>'
          : '') +
        '</div><div class="actions"><button class="btn ghost" data-retire="' + a.id + '">Retire this check</button></div></div>';
    }).join('');
  }

  function renderStale() {
    var list = forWf('stale');
    if (!list.length) return '<div class="empty"><b>Nothing stale.</b><br>Every confirmed check still matches the workflow revision it was confirmed against.</div>';
    return '<div class="honesty">These were confirmed against an earlier revision of this workflow, so they no longer describe what runs. They report as unproven rather than continuing to report green. Re-read each one against the current graph and confirm it again.</div>' +
      list.map(function (a) {
        return '<div class="card"><div class="card-head">' +
          '<span class="chip stale">stale</span> <span class="chip ' + a.basis + '">' + a.basis + '</span>' +
          '<h3>' + esc(a.statement) + '</h3>' +
          '<p class="sink">went stale ' + esc(a.stale ? a.stale.since.slice(0, 10) : '') +
          ', when the workflow moved from ' + esc(a.stale ? a.stale.fromHash.slice(0, 10) : '') + ' to ' + esc(a.stale ? a.stale.toHash.slice(0, 10) : '') + '</p>' +
          '</div><div class="actions"><button class="btn" data-reconfirm="' + a.id + '">Re-read and confirm</button>' +
          '<button class="btn ghost" data-retire="' + a.id + '">Retire it</button></div></div>';
      }).join('');
  }

  function renderHistory() {
    return '<div id="ledger"><div class="empty">Loading the evidence log.</div></div>';
  }

  function loadHistory() {
    api('/api/ledger?workflow=' + encodeURIComponent(current)).then(function (d) {
      var el = document.getElementById('ledger');
      if (!el) return;
      var ok = d.verify && d.verify.ok;
      var head = '<div class="chainok ' + (ok ? 'ok' : 'bad') + '">' +
        (ok ? 'Chain verified: ' + d.entries.length + ' entries, each committing to the one before it.'
            : 'Chain does not verify: ' + esc(d.verify.reason)) + '</div>';
      if (!d.entries.length) { el.innerHTML = head + '<div class="empty">Nothing recorded for this workflow yet.</div>'; return; }
      el.innerHTML = head + '<table class="led"><thead><tr><th>when</th><th>what</th><th>detail</th></tr></thead><tbody>' +
        d.entries.slice().reverse().map(function (e) {
          var detail = e.payload.statement || e.payload.changes || e.payload.reason || e.payload.detail || JSON.stringify(e.payload);
          if (Array.isArray(detail)) detail = detail.join(' ');
          return '<tr><td class="k">' + esc(e.at.slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(e.kind) + '</td><td>' + esc(String(detail).slice(0, 240)) + '</td></tr>';
        }).join('') + '</tbody></table>';
    });
  }

  function render() {
    if (!S) return;
    document.getElementById('hmeta').textContent =
      S.ledgerLength + ' ledger entries · chain ' + (S.ledgerOk ? 'intact' : 'BROKEN');
    renderSidebar();
    var w = wf();
    if (!w) {
      document.getElementById('title').textContent = 'Nothing scanned yet';
      document.getElementById('subtitle').textContent = 'Run silentgreen scan against an n8n instance to populate this.';
      document.getElementById('honesty').textContent = '';
      document.getElementById('body').innerHTML = '';
      return;
    }
    document.getElementById('title').textContent = w.name;
    document.getElementById('subtitle').textContent =
      'revision ' + w.shortHash + ' · ' + (w.active ? 'active' : 'inactive') + ' · last scanned ' + w.lastScannedAt.slice(0, 16).replace('T', ' ');
    document.getElementById('honesty').textContent = w.honesty.sentence;

    Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
      b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    });

    var body = document.getElementById('body');
    body.innerHTML = tab === 'queue' ? renderQueue()
      : tab === 'live' ? renderLive()
      : tab === 'stale' ? renderStale()
      : renderHistory();

    if (tab === 'history') loadHistory();
    wire();
  }

  function wire() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-confirm], [data-reconfirm]'), function (b) {
      b.addEventListener('click', function () { doConfirm(b.dataset.confirm || b.dataset.reconfirm); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-retire]'), function (b) {
      b.addEventListener('click', function () {
        var why = prompt('Why is this one not worth checking? Recorded in the evidence log.');
        if (why === null) return;
        api('/api/retire', { assertionId: b.dataset.retire, by: whoEl.value, why: why }).then(load);
      });
    });
    // Live feedback on the attestation, decided by the same function the gate uses.
    Array.prototype.forEach.call(document.querySelectorAll('textarea[id^="hk-"]'), function (t) {
      var id = t.id.slice(3);
      var timer = null;
      t.addEventListener('input', function () {
        clearTimeout(timer);
        timer = setTimeout(function () {
          api('/api/attestation-check', { howKnown: t.value }).then(function (r) {
            var v = document.getElementById('v-' + id);
            if (!v) return;
            if (!t.value.trim()) { v.textContent = ''; v.className = 'verdict'; return; }
            v.className = 'verdict ' + (r.substantive ? 'yes' : 'no');
            v.textContent = r.substantive
              ? 'That will be accepted, and printed in the report beside every result this check produces.'
              : r.hint;
          });
        }, 260);
      });
    });
  }

  function doConfirm(id) {
    var by = whoEl.value.trim();
    var box = document.getElementById('r-' + id);
    if (!by) {
      if (box) { box.hidden = false; box.textContent = 'Put your name in the box at the top right first. A confirmation records who took responsibility for it, and that name appears in the client report beside the result it produces.'; }
      whoEl.focus();
      return;
    }
    var a = S.assertions.filter(function (x) { return x.id === id; })[0];
    var payload = { assertionId: id, by: by };
    if (a && a.needsAttestation) {
      payload.attestation = {
        windowStart: (document.getElementById('ws-' + id) || {}).value || '',
        windowEnd: (document.getElementById('we-' + id) || {}).value || '',
        howKnown: (document.getElementById('hk-' + id) || {}).value || ''
      };
      // A window whose start and end fall on the same day is still a real
      // window, so treat it as that whole day rather than rejecting it on a
      // technicality the reviewer cannot see.
      if (payload.attestation.windowStart) payload.attestation.windowStart += 'T00:00:00.000Z';
      if (payload.attestation.windowEnd) payload.attestation.windowEnd += 'T23:59:59.000Z';
    }
    api('/api/confirm', payload).then(function (r) {
      if (r.ok) { load(); return; }
      if (box) { box.hidden = false; box.textContent = (r.refusal && r.refusal.message) || r.error || 'Refused.'; }
      // The server's answer is the authoritative one. Clear the advisory hint so
      // the reviewer is not reading two near-identical red paragraphs.
      var v = document.getElementById('v-' + id);
      if (v) { v.textContent = ''; v.className = 'verdict'; }
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll('.tabs button'), function (b) {
    b.addEventListener('click', function () { tab = b.dataset.tab; render(); });
  });

  load();
})();
</script>
</body>
</html>`;

// src/serve/server.ts
function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store"
  });
  res.end(body);
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1e6) throw new Error("Request body too large.");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body was not valid JSON.");
  }
}
function str(v) {
  return typeof v === "string" ? v : "";
}
function stateFor(store) {
  const workflows = store.workflows().map((wf) => {
    const list = store.assertions(wf.id);
    const honesty = coverageHonesty(list);
    return {
      id: wf.id,
      name: wf.name,
      platform: wf.platform,
      active: wf.active,
      hash: wf.hash,
      shortHash: wf.hash.slice(0, 10),
      clientId: wf.clientId,
      lastScannedAt: wf.lastScannedAt,
      counts: store.counts(wf.id),
      honesty,
      sampleRunIds: wf.sampleRunIds,
      observedWindow: wf.observedWindow,
      sinkNames: sinkNames(wf.doc),
      // Only the samples a reviewer might need, trimmed for transport.
      samples: Object.fromEntries(
        Object.entries(wf.samples).map(([k, v]) => [k, v.slice(0, 3)])
      ),
      staleChanges: wf.previousDoc && wf.previousHash !== wf.hash ? { fromHash: wf.previousHash?.slice(0, 10) ?? "" } : void 0
    };
  });
  const assertions = store.assertions().map((a) => {
    const extended = a;
    const req = confirmationRequirements(a.basis);
    return {
      id: a.id,
      workflowId: a.workflowId,
      sinkId: a.sinkId,
      kind: a.kind,
      basis: a.basis,
      statement: a.statement,
      params: a.params,
      status: a.status,
      rationale: extended.rationale ?? "",
      confidence: extended.confidence ?? "moderate",
      needsAttestation: req.needsBaselineAttestation,
      proves: req.proves,
      doesNotProve: req.doesNotProve,
      confirmation: a.confirmation ? {
        by: a.confirmation.by,
        at: a.confirmation.at,
        attestation: a.confirmation.baselineAttestation?.howKnown
      } : void 0,
      stale: a.stale,
      createdAt: a.createdAt
    };
  });
  return {
    workflows,
    assertions,
    clients: store.clients(),
    ledgerLength: store.ledger.length,
    ledgerOk: store.ledger.verify().ok
  };
}
function sinkNames(doc) {
  const out = {};
  for (const n of doc.nodes ?? []) out[n.id && n.id.trim() ? n.id : `name:${n.name}`] = n.name;
  out["*"] = "the workflow as a whole";
  return out;
}
function serve(opts = {}) {
  const port = opts.port ?? 4666;
  const host = opts.host ?? "127.0.0.1";
  const server = createServer((req, res) => {
    void handle(req, res, opts.storeDir).catch((err) => {
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    });
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => {
      resolve({ url: `http://${host}:${port}/`, close: () => server.close() });
    });
  });
}
async function handle(req, res, storeDir) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  if (req.method === "GET" && (path === "/" || path === "/index.html")) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(APP_HTML);
    return;
  }
  const store = new Store(storeDir);
  if (req.method === "GET" && path === "/api/state") {
    json(res, 200, stateFor(store));
    return;
  }
  if (req.method === "POST" && path === "/api/attestation-check") {
    const body = await readBody(req);
    const text = str(body.howKnown);
    json(res, 200, {
      substantive: isSubstantiveAttestation(text),
      hint: 'Name what you checked it against. "Reconciled against the client invoice export for August" is an attestation. "Looks fine" is not, and this sentence is printed in the report beside every result it produces.'
    });
    return;
  }
  if (req.method === "POST" && path === "/api/confirm") {
    const body = await readBody(req);
    const assertionId = str(body.assertionId);
    const by = str(body.by);
    const a = store.assertion(assertionId);
    if (!a) {
      json(res, 404, { error: "No such expectation." });
      return;
    }
    const wf = store.workflow(a.workflowId);
    if (!wf) {
      json(res, 404, { error: "That expectation belongs to a workflow that is no longer in the store." });
      return;
    }
    const att = body.attestation;
    const result = store.confirm(assertionId, {
      by,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      workflowHash: wf.hash,
      evidenceRunIds: wf.sampleRunIds,
      ...att && att.howKnown ? {
        baselineAttestation: {
          windowStart: str(att.windowStart),
          windowEnd: str(att.windowEnd),
          howKnown: str(att.howKnown)
        }
      } : {}
    });
    if (!result.ok) {
      store.save();
      json(res, 200, { ok: false, refusal: result.refusal });
      return;
    }
    store.save();
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && path === "/api/retire") {
    const body = await readBody(req);
    const ok = store.retire(str(body.assertionId), str(body.by), str(body.why));
    store.save();
    json(res, ok ? 200 : 404, { ok });
    return;
  }
  if (req.method === "POST" && path === "/api/client") {
    const body = await readBody(req);
    store.setClient(str(body.workflowId), str(body.clientId), str(body.clientName));
    store.save();
    json(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && path === "/api/ledger") {
    const wfId = url.searchParams.get("workflow");
    const entries = wfId ? store.ledger.forWorkflow(wfId) : store.ledger.all();
    json(res, 200, { entries: entries.slice(-200), verify: store.ledger.verify() });
    return;
  }
  json(res, 404, { error: "Not found." });
}

// src/alert/state.ts
var DEFAULT_REMINDER_HOURS = 24;
var HOUR_MS = 36e5;
function decideAlerts(results, previous, now, reminderHours = DEFAULT_REMINDER_HOURS) {
  const actions = [];
  const next = {};
  const seen = /* @__PURE__ */ new Set();
  for (const r of results) {
    seen.add(r.assertionId);
    const existing = previous[r.assertionId];
    if (r.verdict !== "violated") {
      if (existing && r.verdict === "proven") {
        actions.push({
          kind: "resolved",
          assertionId: r.assertionId,
          statement: r.statement,
          wasFailingHours: hoursBetween(existing.firingSince, now)
        });
        continue;
      }
      if (existing) next[r.assertionId] = existing;
      continue;
    }
    if (!existing) {
      actions.push({ kind: "opened", assertionId: r.assertionId, result: r });
      next[r.assertionId] = {
        firingSince: now.toISOString(),
        lastNotifiedAt: now.toISOString(),
        notifications: 1,
        lastDetail: r.detail
      };
      continue;
    }
    const sinceLast = (now.getTime() - Date.parse(existing.lastNotifiedAt)) / HOUR_MS;
    if (sinceLast >= reminderHours) {
      actions.push({
        kind: "still-failing",
        assertionId: r.assertionId,
        result: r,
        sinceHours: hoursBetween(existing.firingSince, now)
      });
      next[r.assertionId] = {
        ...existing,
        lastNotifiedAt: now.toISOString(),
        notifications: existing.notifications + 1,
        lastDetail: r.detail
      };
    } else {
      next[r.assertionId] = { ...existing, lastDetail: r.detail };
    }
  }
  for (const [id, rec] of Object.entries(previous)) {
    if (!seen.has(id) && !next[id]) next[id] = rec;
  }
  return { actions, state: next };
}
function hoursBetween(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now.getTime() - t) / HOUR_MS);
}
function worstPerAssertion(results) {
  const rank = { violated: 3, unproven: 2, proven: 1 };
  const best = /* @__PURE__ */ new Map();
  for (const r of results) {
    const cur = best.get(r.assertionId);
    if (!cur || rank[r.verdict] > rank[cur.verdict]) best.set(r.assertionId, r);
  }
  return [...best.values()];
}

// src/alert/notify.ts
function channelsFromEnv(env = process.env) {
  const out = [];
  if (env.SILENTGREEN_SLACK_WEBHOOK) out.push({ kind: "slack", url: env.SILENTGREEN_SLACK_WEBHOOK });
  if (env.SILENTGREEN_DISCORD_WEBHOOK) out.push({ kind: "discord", url: env.SILENTGREEN_DISCORD_WEBHOOK });
  if (env.SILENTGREEN_TEAMS_WEBHOOK) out.push({ kind: "teams", url: env.SILENTGREEN_TEAMS_WEBHOOK });
  if (env.SILENTGREEN_WEBHOOK) out.push({ kind: "webhook", url: env.SILENTGREEN_WEBHOOK });
  return out;
}
function renderText(action, ctx) {
  const where = ctx.clientName ? `${ctx.clientName} / ${ctx.workflowName}` : ctx.workflowName;
  if (action.kind === "resolved") {
    return [
      `Recovered: ${where}`,
      `"${action.statement}" is holding again after ${formatHours(action.wasFailingHours)}.`
    ].join("\n");
  }
  const r = action.result;
  const head = action.kind === "opened" ? `Silent failure: ${where}` : `Still failing after ${formatHours(action.sinceHours)}: ${where}`;
  const lines = [head, `"${r.statement}"`];
  if (r.detail) lines.push(r.detail);
  if (r.evidence) lines.push(`Captured: ${truncate(r.evidence, 300)}`);
  lines.push(
    r.basis === "observation" ? "This expectation was learned from history against an attested baseline." : `This expectation came from ${r.basis === "intent" ? "a stated business intent" : "the workflow's own definition"}.`
  );
  return lines.join("\n");
}
function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}\u2026` : s;
}
function formatHours(h) {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} minutes`;
  if (h < 48) return `${h.toFixed(1)} hours`;
  return `${(h / 24).toFixed(1)} days`;
}
function bodyFor(kind, action, ctx) {
  const text = renderText(action, ctx);
  switch (kind) {
    case "slack":
      return { text };
    case "discord":
      return { content: truncate(text, 1900) };
    case "teams":
      return { text };
    case "webhook":
      return {
        kind: action.kind,
        workflow: ctx.workflowName,
        client: ctx.clientName,
        assertionId: action.assertionId,
        statement: action.kind === "resolved" ? action.statement : action.result.statement,
        detail: action.kind === "resolved" ? void 0 : action.result.detail,
        evidence: action.kind === "resolved" ? void 0 : action.result.evidence,
        basis: action.kind === "resolved" ? void 0 : action.result.basis,
        text,
        at: (/* @__PURE__ */ new Date()).toISOString()
      };
  }
}
async function send(channels, action, ctx, opts = {}) {
  const f = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 1e4;
  const results = [];
  for (const ch of channels) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await f(ch.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(bodyFor(ch.kind, action, ctx)),
        signal: ac.signal
      });
      results.push({ channel: ch.kind, ok: res.ok, status: res.status });
    } catch (err) {
      results.push({
        channel: ch.kind,
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return results;
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
function toRecord(item, line, issues) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    issues.push({ line, reason: "Not an object." });
    return void 0;
  }
  const obj = item;
  const output = firstString(obj, OUTPUT_KEYS);
  if (!output) {
    issues.push({
      line,
      reason: `No output found. Looked for: ${OUTPUT_KEYS.join(", ")}. Without an answer there is nothing to check.`
    });
    return void 0;
  }
  const input = firstString(obj, INPUT_KEYS) ?? "";
  const sources = collectSources(obj);
  const id = firstString(obj, ID_KEYS) ?? `line-${line}`;
  const at = firstString(obj, TIME_KEYS);
  return { id, at, input, sources, output, meta: obj };
}
function groundingSourcesFor(record) {
  if (record.sources.length > 0) return { sources: record.sources };
  if (record.input.trim().length > 0) {
    return {
      sources: [record.input],
      note: "No retrieved sources were recorded, so the answer was checked against the prompt alone. Anything the model knew from training will read as ungrounded here, which is stricter than you may want."
    };
  }
  return { sources: [], note: "Neither sources nor a prompt were recorded, so nothing could be checked." };
}

// src/aiwork/check.ts
import { createHash as createHash3 } from "node:crypto";

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
  { kind: "number", re: /\b\d[\d,]*(?:\.\d+)?\b/g },
  { kind: "quote", re: /"([^"\n]{12,200})"/g }
];
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
  for (const { kind, re } of PATTERNS) {
    const found = [];
    for (const m of remaining.matchAll(new RegExp(re.source, re.flags))) {
      const raw = kind === "quote" ? m[1] ?? "" : m[0];
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
function isPresent(atom, sourceRaw, sourceNormalised, sourceNumbers) {
  switch (atom.kind) {
    case "number":
    case "money":
      return sourceNumbers.has(atom.key);
    case "quote": {
      const words = atom.key.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
      const src = sourceNormalised.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ");
      return src.includes(words);
    }
    default:
      return sourceNormalised.includes(atom.key) || sourceRaw.includes(atom.text);
  }
}
function describe2(atom) {
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
    if (!isPresent(atom, sourceRaw, sourceNormalised, sourceNumbers)) {
      ungrounded.push({ ...atom, why: describe2(atom) });
    }
  }
  return { checked: atoms.length, ungrounded, inconclusive: false };
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
  return createHash3("sha256").update(s.toLowerCase().replace(/\s+/g, " ").trim()).digest("hex").slice(0, 16);
}
function checkBatch(records, opts = {}) {
  const duplicateThreshold = opts.duplicateThreshold ?? 3;
  const counts = /* @__PURE__ */ new Map();
  for (const r of records) {
    const fp = fingerprint(r.output);
    counts.set(fp, (counts.get(fp) ?? 0) + 1);
  }
  const results = [];
  const byKind = { degenerate: 0, ungrounded: 0, deferred: 0, duplicated: 0 };
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
    let inconclusive = false;
    let inconclusiveReason;
    let atomsChecked = 0;
    if (!opts.skipGrounding) {
      const { sources, note } = groundingSourcesFor(record);
      const g = checkGrounding(record.output, sources, opts);
      atomsChecked = g.checked;
      if (g.inconclusive) {
        inconclusive = problems.length === 0;
        inconclusiveReason = note ? `${g.reason} ${note}` : g.reason;
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
      inconclusive,
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
      caveat: "This checks whether an answer is empty, refused, unrendered, deferred, duplicated, or contains specifics absent from its own source material. It does not check whether the answer is wise, complete or appropriate, and a clean result is not a claim that the work was good. No model was asked to grade another model."
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

// src/cli.ts
try {
  process.loadEnvFile(".env");
} catch {
}
var ESC = String.fromCharCode(27);
var C = {
  reset: ESC + "[0m",
  dim: ESC + "[2m",
  bold: ESC + "[1m",
  red: ESC + "[31m",
  green: ESC + "[32m",
  yellow: ESC + "[33m",
  blue: ESC + "[36m"
};
var useColour = process.stdout.isTTY && !process.env.NO_COLOR;
function c(code, s) {
  return useColour ? `${code}${s}${C.reset}` : s;
}
function rule(label = "") {
  const width = 74;
  if (!label) {
    console.log(c(C.dim, "-".repeat(width)));
    return;
  }
  console.log(`
${c(C.bold, label)}
${c(C.dim, "-".repeat(width))}`);
}
function arg(rest, flag) {
  const i = rest.indexOf(flag);
  return i >= 0 ? rest[i + 1] : void 0;
}
async function runDemo() {
  const healthyDoc = demoWorkflow(false);
  const editedDoc = demoWorkflow(true);
  const hash = workflowHash(healthyDoc);
  const timeline = demoTimeline();
  const platform = platformSummary(timeline);
  console.log(`
${c(C.bold, "silentgreen")} ${c(C.dim, "worked example")}

A Shopify order sync writing to Postgres and emailing customers. Hourly on
weekdays, six weeks of history. On day 22 the upstream API renamed a field.
`);
  rule("What the platform tells you");
  console.log(`  ${c(C.green, platform.sentence)}`);
  console.log(c(C.dim, "  Nothing here is wrong. It is simply not an answer to the question"));
  console.log(c(C.dim, '  "did the work happen", and it is the only answer most teams have.'));
  const healthyWindowEnd = new Date(Date.parse(timeline.startedAt) + timeline.breakageDay * 864e5);
  const healthyRuns = timeline.runs.filter((r) => Date.parse(r.startedAt) < healthyWindowEnd.getTime());
  const sinks = findSinks(healthyDoc);
  rule("Where work leaves this workflow");
  for (const s of sinks) {
    console.log(`  ${c(C.bold, s.nodeName)} ${c(C.dim, `(${s.category}, importance ${s.importance})`)}`);
    console.log(c(C.dim, `    ${s.rationale}`));
  }
  const proposals = [
    ...proposeFromStructure(DEMO_WORKFLOW_ID, hash, sinks),
    ...proposeFromObservation(DEMO_WORKFLOW_ID, sinks, healthyRuns)
  ];
  rule(`Proposed expectations (${proposals.length})`);
  const byBasis = { intent: 0, structure: 0, observation: 0 };
  for (const p of proposals) byBasis[p.assertion.basis] += 1;
  console.log(
    `  ${byBasis.structure} from the graph's own definition, ${byBasis.observation} learned from ${healthyRuns.length} runs in the healthy window.`
  );
  console.log(c(C.dim, "  None of them can raise anything yet. A proposal is not a check."));
  const { confirmed, refusedCount } = confirmAllForDemo(proposals, hash, timeline, healthyRuns, healthyWindowEnd);
  rule("What a shrug gets you");
  const shrug = confirmAssertion(
    proposals.find((p) => p.assertion.basis === "observation").assertion,
    {
      by: "ops@agency.example",
      at: healthyWindowEnd.toISOString(),
      workflowHash: hash,
      evidenceRunIds: ["exec_0_9"],
      baselineAttestation: { windowStart: timeline.startedAt, windowEnd: healthyWindowEnd.toISOString(), howKnown: "looks fine" }
    },
    { currentWorkflowHash: hash }
  );
  if ("refused" in shrug) console.log(`  ${c(C.yellow, "refused")}  ${shrug.refused.message}`);
  console.log(`
  ${confirmed.length} confirmed, ${refusedCount} refused at the gate.`);
  const profile = inferCadence(healthyRuns);
  rule("Verifying six weeks of runs against those expectations");
  const result = audit({
    workflowId: DEMO_WORKFLOW_ID,
    workflowName: healthyDoc.name ?? "",
    currentHash: hash,
    runs: timeline.runs,
    assertions: confirmed,
    now: new Date(timeline.now),
    cadenceShape: { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours }
  });
  console.log(`  ${c(C.bold, result.headline)}
`);
  console.log(`  proven    ${c(C.green, String(result.counts.proven))}`);
  console.log(`  violated  ${c(C.red, String(result.counts.violated))}`);
  console.log(`  unproven  ${c(C.yellow, String(result.counts.unproven))}`);
  printFindings(result);
  rule("The check that would have rotted");
  for (const ch of diffWorkflows(healthyDoc, editedDoc)) console.log(`  ${ch.description}`);
  const editedHash = workflowHash(editedDoc);
  const afterEdit = audit({
    workflowId: DEMO_WORKFLOW_ID,
    workflowName: healthyDoc.name ?? "",
    currentHash: editedHash,
    runs: timeline.runs,
    assertions: confirmed,
    now: new Date(timeline.now),
    cadenceShape: { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours },
    previousDoc: healthyDoc,
    currentDoc: editedDoc
  });
  console.log("\n  The same expectations against the same runs, one revision later:");
  console.log(`    proven    ${c(C.green, String(afterEdit.counts.proven))}  ${c(C.dim, `(was ${result.counts.proven})`)}`);
  console.log(`    violated  ${c(C.red, String(afterEdit.counts.violated))}  ${c(C.dim, `(was ${result.counts.violated})`)}`);
  console.log(`    unproven  ${c(C.yellow, String(afterEdit.counts.unproven))}  ${c(C.dim, `(was ${result.counts.unproven})`)}`);
  console.log(
    c(C.dim, "\n  Nothing turned green, and nothing kept accusing. The checks stopped claiming\n  to describe a graph they were never confirmed against, and said so out loud.")
  );
  rule("Honesty about coverage");
  console.log(`  ${result.honesty.sentence}`);
  console.log(`
${c(C.dim, "To use the review interface with this example loaded:")}
  silentgreen seed
  silentgreen review

${c(C.dim, "Or against your own n8n:")}
  export N8N_URL=https://your-n8n.example  N8N_API_KEY=...
  silentgreen scan && silentgreen review
`);
}
function confirmAllForDemo(proposals, hash, timeline, healthyRuns, healthyWindowEnd) {
  const confirmed = [];
  let refusedCount = 0;
  for (const p of proposals) {
    const result = confirmAssertion(
      p.assertion,
      {
        by: "ops@agency.example",
        at: healthyWindowEnd.toISOString(),
        workflowHash: hash,
        evidenceRunIds: healthyRuns.slice(0, 3).map((r) => r.id),
        ...p.assertion.basis === "observation" ? {
          baselineAttestation: {
            windowStart: timeline.startedAt,
            windowEnd: healthyWindowEnd.toISOString(),
            howKnown: "Reconciled row counts and a sample of email addresses against the Shopify admin export for that period"
          }
        } : {}
      },
      { currentWorkflowHash: hash }
    );
    if ("assertion" in result) confirmed.push(result.assertion);
    else refusedCount += 1;
  }
  return { confirmed, refusedCount };
}
function printFindings(result) {
  const grouped = /* @__PURE__ */ new Map();
  for (const v of result.violations) {
    const g = grouped.get(v.result.assertionId);
    if (g) g.count += 1;
    else
      grouped.set(v.result.assertionId, {
        statement: v.result.statement,
        count: 1,
        firstAt: v.at,
        detail: v.result.detail,
        evidence: v.result.evidence
      });
  }
  if (grouped.size === 0) return;
  rule(`What was caught (${grouped.size} distinct problems)`);
  for (const g of [...grouped.values()].sort((a, b) => b.count - a.count)) {
    console.log(`  ${c(C.red, "x")} ${c(C.bold, g.statement)}`);
    console.log(
      g.firstAt ? `    ${g.count} run(s), first at ${new Date(g.firstAt).toISOString().slice(0, 16).replace("T", " ")}` : "    detected against the workflow as a whole rather than any single run"
    );
    if (g.detail) console.log(c(C.dim, `    ${g.detail}`));
    if (g.evidence) console.log(`    ${c(C.blue, "captured:")} ${g.evidence.slice(0, 150)}`);
    console.log("");
  }
}
async function runCheck(path, rest) {
  let records;
  let issues = [];
  if (!path || path === "--demo") {
    records = demoTasks();
    console.log(`
${c(C.bold, "silentgreen check")} ${c(C.dim, "worked example")}

Twenty answers from a support agent with the invoice in front of it. Every one
was recorded as a completed task, and every one reads as helpful.
`);
  } else {
    const text = readFileSync3(path, "utf8");
    const parsed = parseTaskRecords(text);
    records = parsed.records;
    issues = parsed.issues;
    console.log(`
${records.length} task(s) read from ${path}.`);
    if (issues.length > 0) {
      console.log(c(C.yellow, `${issues.length} line(s) could not be read, and are not included in any count below:`));
      for (const i of issues.slice(0, 5)) console.log(c(C.dim, `  line ${i.line}: ${i.reason}`));
    }
    if (records.length === 0) {
      console.error(`
Nothing to check. Each line should be a JSON object with an answer in it, for example:

  {"id":"t1","input":"...","sources":["..."],"output":"..."}

Field names are flexible: output/response/answer/completion, sources/context/documents.
`);
      process.exitCode = 1;
      return;
    }
  }
  const { results, summary } = checkBatch(records, {
    skipGrounding: rest.includes("--no-grounding")
  });
  rule("What was found");
  console.log(`  ${c(C.bold, summary.headline)}
`);
  console.log(`  clean         ${c(C.green, String(summary.clean))}`);
  console.log(`  problems      ${c(C.red, String(summary.problematic))}`);
  console.log(`  inconclusive  ${c(C.yellow, String(summary.inconclusive))}`);
  const kinds = [
    ["ungrounded", "facts absent from the source material"],
    ["degenerate", "empty, unrendered or refused"],
    ["deferred", "handed the task back instead of doing it"],
    ["duplicated", "the same answer across different tasks"]
  ];
  console.log("");
  for (const [k, label] of kinds) {
    if (summary.byKind[k] > 0) console.log(`  ${String(summary.byKind[k]).padStart(3)}  ${label}`);
  }
  const bad = results.filter((r) => r.problems.length > 0);
  if (bad.length > 0) {
    rule(`The answers that would have shipped (${bad.length})`);
    for (const r of bad.slice(0, 12)) {
      console.log(`  ${c(C.red, "x")} ${c(C.bold, r.id)}`);
      for (const p of r.problems.slice(0, 4)) {
        console.log(`    ${p.summary}`);
      }
      const first = r.problems[0];
      if (first) console.log(`    ${c(C.blue, "captured:")} ${first.evidence.replace(/\s+/g, " ").slice(0, 140)}`);
      console.log("");
    }
    if (bad.length > 12) console.log(c(C.dim, `  ...and ${bad.length - 12} more.
`));
  }
  rule("What this did not check");
  console.log(`  ${summary.caveat}`);
  if (!path || path === "--demo") {
    console.log(`
${c(C.dim, "Run it on your own:")}
  silentgreen check tasks.jsonl

${c(C.dim, "One JSON object per line. Field names are flexible:")}
  {"id":"t1","input":"...","sources":["..."],"output":"..."}
`);
  }
  if (summary.problematic > 0) process.exitCode = 1;
}
function runSeed(storeDir) {
  const doc = demoWorkflow(false);
  const hash = workflowHash(doc);
  const timeline = demoTimeline();
  const healthyEnd = Date.parse(timeline.startedAt) + timeline.breakageDay * 864e5;
  const healthyRuns = timeline.runs.filter((r) => Date.parse(r.startedAt) < healthyEnd);
  const sinks = findSinks(doc);
  const profile = inferCadence(healthyRuns);
  const store = new Store(storeDir);
  store.observeWorkflow({
    id: DEMO_WORKFLOW_ID,
    platform: "n8n",
    name: doc.name ?? "Worked example",
    active: true,
    hash,
    doc,
    runs: healthyRuns,
    cadenceShape: { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours }
  });
  store.setClient(DEMO_WORKFLOW_ID, "worked-example", "Fernweh Supply (worked example)");
  const proposals = [
    ...proposeFromStructure(DEMO_WORKFLOW_ID, hash, sinks),
    ...proposeFromObservation(DEMO_WORKFLOW_ID, sinks, healthyRuns)
  ];
  const { added, skipped } = store.addProposals(proposals);
  store.save();
  console.log(`
Loaded the worked example into ${storeDir}/

  1 workflow, ${added} expectations waiting for review${skipped ? ` (${skipped} already present)` : ""}.

Nothing is live yet, and nothing can raise anything until you confirm it. That is
the point of the next step:

  silentgreen review

Everything here is fabricated data held on your own disk. Delete ${storeDir}/ to remove it.
`);
}
async function runScan(storeDir) {
  const baseUrl = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error(`Set N8N_URL and N8N_API_KEY first, in the environment or a .env file:

  N8N_URL=https://your-n8n.example
  N8N_API_KEY=n8n_api_...

Create the key under Settings, n8n API. Read access is all this needs and all it
ever uses: there is no code path in this tool that writes to your instance.

To try the review interface with no instance at all:  silentgreen seed`);
    process.exitCode = 1;
    return;
  }
  const client = new N8nClient({ baseUrl, apiKey });
  const store = new Store(storeDir);
  const workflows = await client.listWorkflows();
  console.log(`
${workflows.length} workflow(s) visible to this key.
`);
  let totalAdded = 0;
  for (const wf of workflows) {
    const doc = await client.getWorkflow(wf.id);
    const sinks = findSinks(doc);
    const runs = await client.listRuns(wf.id, { limit: 50, includeData: true });
    const profile = inferCadence(runs);
    const { changes, staled } = store.observeWorkflow({
      id: wf.id,
      platform: "n8n",
      name: wf.name,
      active: wf.active,
      hash: wf.hash,
      doc,
      runs,
      cadenceShape: { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours }
    });
    const proposals = [
      ...proposeFromStructure(wf.id, wf.hash, sinks),
      ...proposeFromObservation(wf.id, sinks, runs)
    ];
    const { added, skipped } = store.addProposals(proposals);
    totalAdded += added;
    console.log(`${c(C.bold, wf.name)} ${c(C.dim, `(${wf.active ? "active" : "inactive"}, revision ${wf.hash.slice(0, 10)})`)}`);
    console.log(c(C.dim, `  ${runs.length} recent run(s), ${sinks.length} sink(s), ${added} new expectation(s)${skipped ? `, ${skipped} already on file` : ""}`));
    if (runs.length === 0) {
      console.log(c(C.yellow, "  No executions retained, so nothing can be proposed from observation yet."));
    }
    if (changes.length > 0) {
      console.log(c(C.yellow, `  This workflow changed since the last scan. ${staled} confirmed check(s) went stale:`));
      for (const ch of changes.slice(0, 6)) console.log(c(C.dim, `    ${ch.description}`));
    }
    console.log("");
  }
  store.save();
  console.log(`${totalAdded} expectation(s) waiting for review. Nothing is live until confirmed:

  silentgreen review
`);
}
async function runVerify(storeDir, opts = {}) {
  const store = new Store(storeDir);
  const workflows = store.workflows();
  if (workflows.length === 0) {
    console.error(`Nothing in ${storeDir}/ yet. Run "silentgreen scan", or "silentgreen seed" to try it with the worked example.`);
    process.exitCode = 1;
    return;
  }
  const outcome = await verifyCycle(store, { quiet: opts.quiet });
  if (opts.notify) {
    await dispatchAlerts(store, outcome, channelsFromEnv());
  }
  store.save();
  if (!opts.quiet) {
    console.log(c(C.dim, `Recorded in ${storeDir}/ledger.jsonl. Exit code is 1 when anything was violated, so this fits a cron job.`));
  }
  if (outcome.anyViolation) process.exitCode = 1;
}
async function verifyCycle(store, opts = {}) {
  const workflows = store.workflows();
  const baseUrl = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  const client = baseUrl && apiKey ? new N8nClient({ baseUrl, apiKey }) : void 0;
  let anyViolation = false;
  const allResults = [];
  const context = /* @__PURE__ */ new Map();
  for (const wf of workflows) {
    const confirmed = store.assertions(wf.id).filter((a) => a.status === "confirmed");
    const isWorkedExample = wf.id === DEMO_WORKFLOW_ID;
    let runs;
    let now = /* @__PURE__ */ new Date();
    if (isWorkedExample) {
      const t = demoTimeline();
      runs = t.runs;
      now = new Date(t.now);
    } else if (client) {
      runs = await client.listRuns(wf.id, { limit: 50, includeData: true });
    } else {
      if (!opts.quiet) {
        console.log(`${c(C.bold, wf.name)}`);
        console.log(c(C.yellow, "  Skipped: no N8N_URL and N8N_API_KEY, so recent runs could not be fetched."));
      }
      continue;
    }
    const result = audit({
      workflowId: wf.id,
      workflowName: wf.name,
      currentHash: wf.hash,
      runs,
      assertions: confirmed,
      now,
      cadenceShape: wf.cadenceShape
    });
    const clientName = wf.clientId ? store.clients()[wf.clientId]?.name ?? wf.clientId : void 0;
    for (const r of result.perRun.flatMap((p) => p.results)) {
      allResults.push(r);
      context.set(r.assertionId, { workflowName: wf.name, clientName });
    }
    if (result.cadence) {
      allResults.push(result.cadence);
      context.set(result.cadence.assertionId, { workflowName: wf.name, clientName });
    }
    if (!opts.quiet) {
      console.log(`${c(C.bold, wf.name)}${isWorkedExample ? c(C.dim, "  (worked example, fabricated data)") : ""}`);
      console.log(`  ${result.headline}`);
      console.log(
        `  proven ${c(C.green, String(result.counts.proven))}  violated ${c(C.red, String(result.counts.violated))}  unproven ${c(C.yellow, String(result.counts.unproven))}`
      );
    }
    for (const v of result.violations) {
      store.ledger.append(
        v.result.verdict === "violated" && !v.runId ? "absence-detected" : "violation",
        wf.id,
        {
          assertionId: v.result.assertionId,
          statement: v.result.statement,
          runId: v.runId,
          detail: v.result.detail,
          evidence: v.result.evidence
        },
        { clientId: wf.clientId }
      );
    }
    store.ledger.append(
      "run-verified",
      wf.id,
      { runsExamined: result.runsExamined, proven: result.counts.proven, violated: result.counts.violated, unproven: result.counts.unproven },
      { clientId: wf.clientId }
    );
    if (result.counts.violated > 0) anyViolation = true;
    if (!opts.quiet) printFindings(result);
  }
  return { anyViolation, results: allResults, context };
}
async function dispatchAlerts(store, outcome, channels) {
  const perAssertion = worstPerAssertion(outcome.results);
  const { actions, state } = decideAlerts(perAssertion, store.alerts(), /* @__PURE__ */ new Date());
  store.setAlerts(state);
  if (actions.length === 0) return;
  if (channels.length === 0) {
    console.log(
      c(C.yellow, `
${actions.length} alert(s) would have been sent, but no channel is configured.`)
    );
    console.log(c(C.dim, "  Set SILENTGREEN_SLACK_WEBHOOK, SILENTGREEN_DISCORD_WEBHOOK, SILENTGREEN_TEAMS_WEBHOOK"));
    console.log(c(C.dim, "  or SILENTGREEN_WEBHOOK. Nothing is being delivered until you do, and this tool"));
    console.log(c(C.dim, "  will not pretend otherwise."));
    for (const a of actions) {
      const ctx = outcome.context.get(a.assertionId) ?? { workflowName: "unknown workflow" };
      console.log(`
${renderText(a, ctx)}`);
    }
    return;
  }
  for (const action of actions) {
    const ctx = outcome.context.get(action.assertionId) ?? { workflowName: "unknown workflow" };
    const delivery = await send(channels, action, ctx);
    const failed = delivery.filter((d) => !d.ok);
    store.ledger.append("note", "alerting", {
      alert: action.kind,
      assertionId: action.assertionId,
      workflow: ctx.workflowName,
      delivered: delivery.filter((d) => d.ok).map((d) => d.channel),
      failed: failed.map((d) => ({ channel: d.channel, status: d.status, error: d.error }))
    });
    const label = action.kind === "resolved" ? c(C.green, "recovered") : c(C.red, action.kind);
    console.log(`  alert ${label}: ${ctx.workflowName}`);
    for (const f of failed) {
      console.log(
        c(C.red, `    delivery to ${f.channel} FAILED${f.status ? ` (HTTP ${f.status})` : ""}${f.error ? `: ${f.error}` : ""}`)
      );
    }
  }
}
async function runWatch(storeDir, intervalSeconds) {
  const channels = channelsFromEnv();
  const opening = new Store(storeDir);
  const live = opening.assertions().filter((a) => a.status === "confirmed").length;
  const stale = opening.assertions().filter((a) => a.status === "stale").length;
  const waiting = opening.assertions().filter((a) => a.status === "proposed").length;
  console.log(`
${c(C.bold, "silentgreen watch")}

Checking every ${intervalSeconds >= 60 ? `${Math.round(intervalSeconds / 60)} minutes` : `${intervalSeconds} seconds`}, reading ${storeDir}/.
${opening.workflows().length} workflow(s), ${live} live check(s)${stale ? `, ${stale} stale` : ""}${waiting ? `, ${waiting} waiting for review` : ""}.
${channels.length > 0 ? `Alerting to: ${channels.map((ch) => ch.kind).join(", ")}.` : c(C.yellow, "No alert channel is configured, so nothing will be delivered. Alerts will be printed here instead.")}
Press Ctrl+C to stop.
`);
  if (live === 0) {
    console.log(c(C.yellow, "Nothing is confirmed, so this will watch and find nothing, every cycle, forever."));
    console.log(c(C.yellow, `Confirm something first: silentgreen review${waiting ? ` (${waiting} waiting)` : ""}`));
    console.log("");
  }
  let cycle = 0;
  for (; ; ) {
    cycle += 1;
    const startedAt = /* @__PURE__ */ new Date();
    try {
      const store = new Store(storeDir);
      const outcome = await verifyCycle(store, { quiet: true });
      await dispatchAlerts(store, outcome, channels);
      store.save();
      const worst2 = worstPerAssertion(outcome.results);
      const violated2 = worst2.filter((r) => r.verdict === "violated").length;
      const unproven2 = worst2.filter((r) => r.verdict === "unproven").length;
      const proven2 = worst2.filter((r) => r.verdict === "proven").length;
      console.log(
        `${startedAt.toISOString().slice(11, 19)}  cycle ${cycle}: ${c(C.green, String(proven2))} proven, ${c(C.red, String(violated2))} violated, ${c(C.yellow, String(unproven2))} unproven`
      );
    } catch (err) {
      console.error(c(C.red, `${startedAt.toISOString().slice(11, 19)}  cycle ${cycle} failed: ${err instanceof Error ? err.message : String(err)}`));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1e3));
  }
}
async function runReport(storeDir, outPath, clientFilter) {
  const store = new Store(storeDir);
  const workflows = store.workflows().filter((w) => !clientFilter || w.clientId === clientFilter);
  if (workflows.length === 0) {
    console.error(`No workflows in ${storeDir}/${clientFilter ? ` for client "${clientFilter}"` : ""}. Run "silentgreen seed" or "silentgreen scan" first.`);
    process.exitCode = 1;
    return;
  }
  const wf = workflows[0];
  const confirmed = store.assertions(wf.id).filter((a) => a.status === "confirmed");
  const isWorkedExample = wf.id === DEMO_WORKFLOW_ID;
  const baseUrl = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  let runs = [];
  let now = /* @__PURE__ */ new Date();
  let periodStart = new Date(Date.now() - 30 * 864e5).toISOString();
  if (isWorkedExample) {
    const t = demoTimeline();
    runs = t.runs;
    now = new Date(t.now);
    periodStart = t.startedAt;
  } else if (baseUrl && apiKey) {
    runs = await new N8nClient({ baseUrl, apiKey }).listRuns(wf.id, { limit: 200, includeData: true });
    if (runs.length > 0) periodStart = runs[runs.length - 1].startedAt;
  }
  const result = audit({
    workflowId: wf.id,
    workflowName: wf.name,
    currentHash: wf.hash,
    runs,
    assertions: confirmed,
    now,
    cadenceShape: wf.cadenceShape,
    previousDoc: wf.previousDoc,
    currentDoc: wf.doc
  });
  const platform = {
    executions: runs.length,
    succeeded: runs.filter((r) => r.platformStatus === "success").length,
    failed: runs.filter((r) => r.platformStatus === "error").length,
    sentence: `${runs.length} executions, ${runs.filter((r) => r.platformStatus === "success").length} successful, ${runs.filter((r) => r.platformStatus === "error").length} failed.`
  };
  const html = renderReport({
    result,
    assertions: confirmed,
    ledger: store.ledger,
    periodStart,
    periodEnd: now.toISOString(),
    clientName: wf.clientId ? store.clients()[wf.clientId]?.name ?? wf.clientId : wf.name,
    preparedBy: confirmed[0]?.confirmation?.by ?? "silentgreen",
    platform
  });
  writeFileSync2(outPath, html, "utf8");
  console.log(`Report written to ${outPath}`);
  if (isWorkedExample) console.log(c(C.dim, "This one is the worked example, so the figures are fabricated. Say so if you show it to anybody."));
}
function runStatus(storeDir) {
  const store = new Store(storeDir);
  const wfs = store.workflows();
  const chain = store.ledger.verify();
  console.log(`
${c(C.bold, "silentgreen")} ${c(C.dim, storeDir + "/")}`);
  console.log(c(C.dim, `${store.ledger.length} ledger entries, chain ${chain.ok ? "intact" : "BROKEN"}
`));
  if (wfs.length === 0) {
    console.log('Nothing scanned yet. Try "silentgreen seed" or "silentgreen scan".\n');
    return;
  }
  for (const wf of wfs) {
    const n = store.counts(wf.id);
    console.log(`${c(C.bold, wf.name)} ${c(C.dim, `(${wf.hash.slice(0, 10)}, scanned ${wf.lastScannedAt.slice(0, 10)})`)}`);
    console.log(
      `  ${n.proposed} to review, ${c(C.green, String(n.confirmed))} live${n.stale ? `, ${c(C.yellow, String(n.stale))} stale` : ""}${n.retired ? `, ${n.retired} retired` : ""}`
    );
    const honesty = store.assertions(wf.id);
    const live = honesty.filter((a) => a.status === "confirmed");
    if (live.length === 0) {
      console.log(c(C.yellow, "  Nothing is being verified. Any green elsewhere means code ran, not that work happened."));
    }
    console.log("");
  }
}
async function main() {
  const [command = "demo", ...rest] = process.argv.slice(2);
  const storeDir = arg(rest, "--store") ?? STORE_DIR;
  switch (command) {
    case "check":
      return runCheck(rest.find((r) => !r.startsWith("--")), rest);
    case "demo":
      return runDemo();
    case "seed":
      return runSeed(storeDir);
    case "scan":
      return runScan(storeDir);
    case "verify":
      return runVerify(storeDir, { notify: rest.includes("--notify") });
    case "watch":
      return runWatch(storeDir, Number(arg(rest, "--interval") ?? 300));
    case "status":
      return runStatus(storeDir);
    case "review": {
      const port = Number(arg(rest, "--port") ?? 4666);
      const { url } = await serve({ port, storeDir });
      console.log(`
${c(C.bold, "Review interface")}  ${url}

Reading ${storeDir}/. Confirm or refuse the expectations waiting there.
Nothing can raise an alert until you do. Press Ctrl+C to stop.
`);
      return new Promise(() => {
      });
    }
    case "report":
      return runReport(storeDir, arg(rest, "--out") ?? "silentgreen-report.html", arg(rest, "--client"));
    case "help":
    case "--help":
    case "-h":
      console.log(`silentgreen

  check [file.jsonl]       verify a batch of AI work. No credentials, no setup.
  demo                     the n8n worked example, printed
  seed                     load that example into a local store
  scan                     read an n8n instance and propose expectations
  review [--port 4666]     open the review interface to confirm them
  verify [--notify]        check recent runs against confirmed expectations
  watch [--interval 300]   keep checking, and alert when something changes
  report [--out f.html]    produce the client evidence record
  status                   what is in the store

  --store DIR              where to keep state (default ${STORE_DIR}/)
  N8N_URL, N8N_API_KEY     read-only credentials for scan and verify

  Alert channels, all optional, all plain webhooks:
    SILENTGREEN_SLACK_WEBHOOK
    SILENTGREEN_DISCORD_WEBHOOK
    SILENTGREEN_TEAMS_WEBHOOK
    SILENTGREEN_WEBHOOK      generic JSON POST
`);
      return;
    default:
      console.error(`Unknown command "${command}". Try: silentgreen help`);
      process.exitCode = 1;
  }
}
main().catch((err) => {
  if (err instanceof N8nError) {
    console.error(`
${err.message}`);
    if (err.hint) console.error(err.hint);
    process.exit(1);
  }
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
