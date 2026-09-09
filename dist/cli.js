#!/usr/bin/env node

// src/cli.ts
import { writeFileSync } from "node:fs";

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
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const entries = Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`);
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

// src/cli.ts
try {
  process.loadEnvFile(".env");
} catch {
}
var C = {
  reset: "\x1B[0m",
  dim: "\x1B[2m",
  bold: "\x1B[1m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[36m"
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
  rule(`Proposed contracts (${proposals.length})`);
  const byBasis = { intent: 0, structure: 0, observation: 0 };
  for (const p of proposals) byBasis[p.assertion.basis] += 1;
  console.log(
    `  ${byBasis.structure} from the graph's own definition, ${byBasis.observation} learned from ${healthyRuns.length} runs in the healthy window.`
  );
  console.log(c(C.dim, "  None of them can raise anything yet. A proposal is not a check."));
  const ledger = new Ledger();
  ledger.append("workflow-observed", DEMO_WORKFLOW_ID, { name: healthyDoc.name, hash });
  const confirmed = [];
  let refusedCount = 0;
  for (const p of proposals) {
    const needsAttestation = p.assertion.basis === "observation";
    const result2 = confirmAssertion(
      p.assertion,
      {
        by: "ops@agency.example",
        at: healthyWindowEnd.toISOString(),
        workflowHash: hash,
        evidenceRunIds: healthyRuns.slice(0, 3).map((r) => r.id),
        ...needsAttestation ? {
          baselineAttestation: {
            windowStart: timeline.startedAt,
            windowEnd: healthyWindowEnd.toISOString(),
            howKnown: "Reconciled row counts and a sample of email addresses against the Shopify admin export for that period"
          }
        } : {}
      },
      { currentWorkflowHash: hash }
    );
    if ("assertion" in result2) {
      confirmed.push(result2.assertion);
      ledger.append("assertion-confirmed", DEMO_WORKFLOW_ID, {
        assertionId: result2.assertion.id,
        statement: result2.assertion.statement,
        basis: result2.assertion.basis,
        by: "ops@agency.example"
      });
    } else {
      refusedCount += 1;
    }
  }
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
  if ("refused" in shrug) {
    console.log(`  ${c(C.yellow, "refused")}  ${shrug.refused.message}`);
  }
  console.log(`
  ${confirmed.length} confirmed, ${refusedCount} refused at the gate.`);
  const profile = inferCadence(healthyRuns);
  rule("Verifying six weeks of runs against those contracts");
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
  const grouped = /* @__PURE__ */ new Map();
  for (const v of result.violations) {
    const key = v.result.assertionId;
    const g = grouped.get(key);
    if (g) {
      g.count += 1;
    } else {
      grouped.set(key, {
        statement: v.result.statement,
        count: 1,
        firstAt: v.at,
        detail: v.result.detail,
        evidence: v.result.evidence
      });
    }
  }
  rule(`What was caught (${grouped.size} distinct problems)`);
  for (const g of [...grouped.values()].sort((a, b) => b.count - a.count)) {
    console.log(`  ${c(C.red, "\u2717")} ${c(C.bold, g.statement)}`);
    console.log(
      g.firstAt ? `    ${g.count} run(s), first at ${new Date(g.firstAt).toISOString().slice(0, 16).replace("T", " ")}` : "    detected against the workflow as a whole rather than any single run"
    );
    if (g.detail) console.log(c(C.dim, `    ${g.detail}`));
    if (g.evidence) console.log(`    ${c(C.blue, "captured:")} ${g.evidence.slice(0, 150)}`);
    console.log("");
  }
  rule("The check that would have rotted");
  const changes = diffWorkflows(healthyDoc, editedDoc);
  for (const ch of changes) console.log(`  ${ch.description}`);
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
  console.log("\n  The same contracts against the same runs, one revision later:");
  console.log(`    proven    ${c(C.green, String(afterEdit.counts.proven))}  ${c(C.dim, `(was ${result.counts.proven})`)}`);
  console.log(`    violated  ${c(C.red, String(afterEdit.counts.violated))}  ${c(C.dim, `(was ${result.counts.violated})`)}`);
  console.log(`    unproven  ${c(C.yellow, String(afterEdit.counts.unproven))}  ${c(C.dim, `(was ${result.counts.unproven})`)}`);
  console.log(
    c(C.dim, "\n  Nothing turned green, and nothing kept accusing. The checks stopped claiming\n  to describe a graph they were never confirmed against, and said so out loud.\n  That is the difference between a check that goes stale and one that rots.")
  );
  rule("Honesty about coverage");
  console.log(`  ${result.honesty.sentence}`);
  console.log(
    c(C.dim, `
  ${result.honesty.byBasis.intent} intent, ${result.honesty.byBasis.structure} structure, ${result.honesty.byBasis.observation} observation.`)
  );
  console.log(
    c(C.dim, "  No check here traces back to a stated business intent, because nobody has\n  yet said what this workflow is for. Until they do, this can prove the sync\n  has not changed. It cannot prove it was ever right.")
  );
  const chain = ledger.verify();
  rule("Evidence ledger");
  console.log(`  ${ledger.length} entries, chain ${chain.ok ? c(C.green, "intact") : c(C.red, "broken")}.`);
  console.log(c(C.dim, "  Every confirmation records who took responsibility and what they were shown."));
  console.log(`
${c(C.dim, "Run it against your own n8n:")}
  export N8N_URL=https://your-n8n.example  N8N_API_KEY=...
  npx silentgreen scan
`);
}
async function runScan() {
  const baseUrl = process.env.N8N_URL;
  const apiKey = process.env.N8N_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error(`Set N8N_URL and N8N_API_KEY first, either in the environment or in a .env file:

  N8N_URL=https://your-n8n.example
  N8N_API_KEY=n8n_api_...

Create the key under Settings, n8n API. Read access is all this needs, and all
it ever uses: there is no code path in this tool that writes to your instance.

To see what it does without connecting anything, run:  npx silentgreen demo`);
    process.exitCode = 1;
    return;
  }
  const client = new N8nClient({ baseUrl, apiKey });
  const workflows = await client.listWorkflows();
  console.log(`
${workflows.length} workflow(s) visible to this key.
`);
  for (const wf of workflows) {
    const doc = await client.getWorkflow(wf.id);
    const sinks = findSinks(doc);
    const runs = await client.listRuns(wf.id, { limit: 50, includeData: true });
    const proposals = [
      ...proposeFromStructure(wf.id, wf.hash, sinks),
      ...proposeFromObservation(wf.id, sinks, runs)
    ];
    const cadence = inferCadence(runs);
    console.log(`${c(C.bold, wf.name)} ${c(C.dim, `(${wf.id}, ${wf.active ? "active" : "inactive"})`)}`);
    console.log(c(C.dim, `  revision ${wf.hash.slice(0, 12)}, ${runs.length} recent run(s), ${sinks.length} sink(s)`));
    if (runs.length === 0) {
      console.log(c(C.yellow, "  No executions retained, so nothing can be proposed from observation yet."));
    }
    for (const p of proposals) {
      const tag = p.assertion.basis === "observation" ? c(C.yellow, "observation") : c(C.blue, p.assertion.basis);
      console.log(`  [${tag}] ${p.assertion.statement}`);
      console.log(c(C.dim, `      ${p.rationale}`));
    }
    if (cadence) console.log(c(C.dim, `  cadence: ${cadence.reasoning}`));
    console.log("");
  }
  console.log(c(C.dim, "Nothing above is active yet. A proposal cannot raise an alert until a person"));
  console.log(c(C.dim, "confirms it, and observation-basis proposals additionally require you to state"));
  console.log(c(C.dim, "which period you believe was correct, and how you know."));
}
async function runReport(outPath) {
  const doc = demoWorkflow(false);
  const hash = workflowHash(doc);
  const timeline = demoTimeline();
  const healthyEnd = Date.parse(timeline.startedAt) + timeline.breakageDay * 864e5;
  const healthyRuns = timeline.runs.filter((r) => Date.parse(r.startedAt) < healthyEnd);
  const sinks = findSinks(doc);
  const proposals = [
    ...proposeFromStructure(DEMO_WORKFLOW_ID, hash, sinks),
    ...proposeFromObservation(DEMO_WORKFLOW_ID, sinks, healthyRuns)
  ];
  const confirmed = [];
  for (const p of proposals) {
    const r = confirmAssertion(
      p.assertion,
      {
        by: "ops@agency.example",
        at: new Date(healthyEnd).toISOString(),
        workflowHash: hash,
        evidenceRunIds: healthyRuns.slice(0, 3).map((x) => x.id),
        ...p.assertion.basis === "observation" ? {
          baselineAttestation: {
            windowStart: timeline.startedAt,
            windowEnd: new Date(healthyEnd).toISOString(),
            howKnown: "Reconciled row counts and a sample of email addresses against the Shopify admin export for that period"
          }
        } : {}
      },
      { currentWorkflowHash: hash }
    );
    if ("assertion" in r) confirmed.push(r.assertion);
  }
  const profile = inferCadence(healthyRuns);
  const result = audit({
    workflowId: DEMO_WORKFLOW_ID,
    workflowName: doc.name ?? "",
    currentHash: hash,
    runs: timeline.runs,
    assertions: confirmed,
    now: new Date(timeline.now),
    cadenceShape: { weekdaysOnly: profile?.weekdaysOnly, activeHours: profile?.activeHours }
  });
  const ledger = new Ledger();
  ledger.append("workflow-observed", DEMO_WORKFLOW_ID, { name: doc.name, hash });
  for (const a of confirmed) {
    ledger.append("assertion-confirmed", DEMO_WORKFLOW_ID, { assertionId: a.id, statement: a.statement, basis: a.basis, by: a.confirmation?.by });
  }
  for (const v of result.violations.slice(0, 50)) {
    ledger.append("violation", DEMO_WORKFLOW_ID, { assertionId: v.result.assertionId, runId: v.runId, detail: v.result.detail });
  }
  const html = renderReport({
    result,
    assertions: confirmed,
    ledger,
    periodStart: timeline.startedAt,
    periodEnd: timeline.now,
    clientName: "Fernweh Supply",
    preparedBy: "ops@agency.example",
    platform: platformSummary(timeline)
  });
  writeFileSync(outPath, html, "utf8");
  console.log(`Report written to ${outPath}`);
}
async function main() {
  const [command = "demo", ...rest] = process.argv.slice(2);
  switch (command) {
    case "demo":
      return runDemo();
    case "scan":
      return runScan();
    case "report": {
      const i = rest.indexOf("--out");
      return runReport(i >= 0 ? rest[i + 1] ?? "silentgreen-report.html" : "silentgreen-report.html");
    }
    case "help":
    case "--help":
    case "-h":
      console.log(`silentgreen

  demo                    the worked example, no credentials needed
  scan                    read an n8n instance and propose contracts
  report --out FILE.html  produce the client evidence report

  N8N_URL, N8N_API_KEY    read-only credentials for scan
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
