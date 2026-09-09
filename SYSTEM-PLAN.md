# silentgreen: system plan

The product verifies work done by AI and by automations, and it never asks a model to
grade a model. This document is the full architecture and the phased plan to build it out
into a service: free for individual users, paid for agencies and teams.

It is written to be honest about what is built (roughly 15 percent of what follows), what
is load bearing, and what is still a claim rather than a result.

---

## 1. What the product is

**One sentence.** You point silentgreen at the output of an AI pipeline or an automation,
and it tells you either "here is the proof it did the job", "here is the proof it did not",
or "this cannot be proven and here is exactly what is missing". It is the third answer that
the rest of this market refuses to give.

**The unit of work is a task.** Something was asked, some material was available, an answer
came back, and sometimes actions were taken. That shape is identical whether the source is
an agent framework, a RAG pipeline, a support bot, a batch summariser, an n8n workflow or a
spreadsheet somebody exported. Every one of them has the same failure: the output looks
right, it was recorded as a success, and nobody can afford to check all of them by hand.

**Who it is for.**

- Individual developers and small teams running an AI feature in production. Free.
- Agencies and platform teams running many pipelines for many clients, who need proof they
  can hand to a client or an auditor. Paid.

**What it is not.** It is not a quality score. It does not tell you an answer is wise,
complete, well judged or on brand. A clean result is a narrow, keepable promise: nothing in
this output contradicts the material it was given, and the pipeline did not quietly fail.

---

## 2. The verification model

Three ideas hold the whole system together. Everything else is plumbing.

### 2.1 Three verdicts, never "pass"

Every check returns one of:

| verdict | meaning |
| --- | --- |
| `proven` | there is evidence in text the model did not write that the expectation held |
| `violated` | there is evidence the expectation did not hold |
| `unproven` | the evidence to decide either way is not present, and here is what is missing |

`unproven` is a first class result. It never raises an alert, it is never coloured green,
and it is never hidden. A tool that collapses `unproven` into `pass` is the exact tool this
one exists to replace.

### 2.2 Basis awareness

Every expectation carries a basis, which records where it came from. The basis decides what
a `proven` result is allowed to mean.

| basis | source of the expectation | what `proven` proves |
| --- | --- | --- |
| `intent` | a human wrote down what the task is for | the work matches what a person asked for |
| `structure` | read from the code, the workflow definition, a schema | the work is consistent with how the system is built |
| `observation` | learned from the system's own execution history | the work is consistent with what the system used to do |

The trap the whole market falls into: a baseline learned from output can only ever
establish consistency, never correctness. If a workflow has dropped 5 percent of rows since
the day it shipped, a baseline learned from its history ratifies the 5 percent as normal.
So an `observation` expectation cannot become a live check until the confirmation gate is
passed.

### 2.3 The confirmation gate

An `observation` expectation is inert until a human names the window they believe was good
and says, in a substantive sentence, how they know it was good.

- "Reconciled against the client's invoice export for March" passes.
- "Looks fine" is refused, with an explanation of why.

Whatever they write is printed in every report next to every `proven` result that
expectation produces. In practice this sentence is a stronger filter than any validation
rule, because it forces someone to own the claim.

---

## 3. The checks

Organised by what each check needs in order to run. A user gets value at tier 0 with zero
configuration; each tier up adds checks and needs more from the user.

### Tier 0: needs only the single task

No config, no history, no contract. This is the free on-ramp and it must be excellent.

| check | catches |
| --- | --- |
| degenerate output | empty string, unrendered template (`Hi {{name}}`), refusal text in a content field, raw error string, `null` literal |
| deferral | a short answer that hands the task back to a human and is booked as resolved |
| groundedness | every checkable atom in the answer (money, number, date, email, URL, identifier, quoted span, proper name) is present in the source material, or it is reported |
| internal consistency | figures in the answer that contradict each other, a total that does not equal its parts, a date range that runs backwards |
| structural conformance | if the output claims to be JSON, a table, or a known schema, it parses and the required shape is present |

### Tier 1: needs the batch

| check | catches |
| --- | --- |
| duplication | one answer produced for many different inputs, which is what a pipeline looks like when it stopped reading its input |
| distribution drift | refusal rate, deferral rate, answer length, atom density moving sharply against the rest of the batch or against history |
| outliers | the single task that does not look like its neighbours |

### Tier 2: needs intent (a human wrote a contract)

A contract is a short YAML or DSL file. Example lives in section 5.

| check | catches |
| --- | --- |
| required fields | the answer is missing something the task always needs (an amount, a reference, a next step) |
| value predicates | `total > 0`, `due_date within 90 days`, `currency == source.currency` |
| required actions | the email was actually sent, the row was actually written, the ticket was actually closed, not just described |
| forbidden behaviour | never disclose another customer's data, never promise a refund, never invent a policy |

### Tier 3: needs structure (read the pipeline or the code)

| check | catches |
| --- | --- |
| semantic change detection | the workflow logic or the prompt changed underneath a check that is still passing |
| schema drift | an upstream API contract changed and the pipeline did not notice |
| path coverage | which branches of the pipeline were actually exercised by this batch |

### Tier 4: needs observation plus confirmation

| check | catches |
| --- | --- |
| cadence and absence | the workflow silently stopped firing, discounted for weekends and out of hours |
| volume contracts | row counts, throughput, batch size drifting outside a confirmed-good band |
| learned value ranges | amounts or counts outside the range seen during the confirmed window |

---

## 4. System architecture

```
  ingestion adapters
        |
        v
  normalisation  ------>  TaskRecord + ActionRecord[]
        |
        v
  verification engine  <-----  contract store (intent)
   (pure, deterministic,  <---  structure inference
    versioned checks)     <---  observation baselines + confirmation state
        |
        v
  evidence store  (hash-chained, append-only)
        |
        +--> CLI report
        +--> dashboard
        +--> review queue  (the confirmation gate)
        +--> task inspector
        +--> CI annotations
        +--> alerts  (Slack / Discord / Teams / webhook / email)
        +--> API
```

### 4.1 Ingestion adapters

Every adapter produces the same normalised record. Order of build in section 9.

- File: JSONL, JSON array, CSV.
- SDK: a thin wrapper you put around your agent or chain call that records input, sources,
  output and actions. One function, no dependencies.
- Push: a REST endpoint that accepts a batch or a stream of tasks.
- Observability connectors: LangSmith, Langfuse, Braintrust, Helicone. These already store
  the exact shape we need.
- Automation connectors: n8n REST API, Make API v2, Zapier, a generic inbound webhook.
- CI: a GitHub Action that runs `check` on a fixture set and comments on the PR.

### 4.2 Normalisation

```
TaskRecord   { id, at, input, sources[], output, meta }
ActionRecord { id, taskId, at, kind, target, payload, result }
```

Field names in the wild are inconsistent, so the parser is forgiving: `output` or
`response` or `answer` or `completion`; `sources` or `context` or `documents` or
`retrieved`; documents as strings or as `{ page_content }` objects. Lines that cannot be
read are reported, never dropped.

### 4.3 Verification engine

- Pure functions. Given the same input and the same check versions, the same verdicts.
- Each check is a module with a stable id and a version number. A verdict records both.
  Changing a check does not silently rewrite the meaning of past verdicts.
- Runs in-process for the CLI, and as a queue worker for the hosted service. Same code.
- No network calls during verification. No model calls that decide a verdict. A model may
  be used to *find candidates to check* (section 6), never to decide whether a check
  passed.

### 4.4 Contract store

- `intent` contracts: human-authored files, versioned in the user's own repo, loaded by
  path.
- `structure` contracts: inferred from the workflow or schema, re-inferred on change,
  diffed.
- `observation` baselines: a learned profile plus its confirmation state
  (`unconfirmed` | `confirmed` with attestation text and window | `stale` after the
  underlying system changed).

### 4.5 Evidence store

- Hash-chained, append-only. Each entry links to the previous by hash, so the log is
  tamper evident and a reload cannot change a past verdict.
- Local: JSONL file. Hosted: Postgres with the same chain semantics.
- Every entry carries the literal text that decided the verdict. Never a paraphrase.
- Retention is a tier setting. Free tier stores verdicts plus redacted evidence
  (section 8). Paid tiers store full evidence with a chosen TTL.

### 4.6 Alert state machine

- A violation opens an alert once.
- It stays quiet for a reminder window (default 24h) unless it worsens.
- It resolves once, when a later run proves the expectation held.
- `unproven` never alerts.

---

## 5. The contract DSL

Small, declarative, lives in the user's repo. Example for a billing support agent:

```yaml
pipeline: billing-support-agent
basis: intent
attests: "Harsh, 2026-09, these rules are what the agent is contracted to do"

output:
  must_contain:
    - kind: money         # an amount is always quoted
    - kind: date          # a due date is always given
  must_not_contain:
    - pattern: refund|credit note        # the agent may not promise these
  grounded:
    kinds: [money, date, identifier, email, url]   # these must trace to source

actions:
  when: output mentions "I have emailed"
  require:
    - kind: email.sent
      to_matches: source.customer_email

consistency:
  - "every money atom in output <= max(money atoms in source) * 1.0"
```

Inference fills in a first draft of this from a batch, and the user edits it. The `attests`
line is mandatory and is printed in every report.

---

## 6. The extraction layer

This is the current weak point and the place rigour is won or lost. A false accusation that
an AI fabricated something is worse than a miss, because the miss leaves the user where
they already were and the accusation makes silentgreen the problem.

### 6.1 Three layers, one rule

**The rule: a model may help decide what to check. A model never decides whether the check
passed.** Every pass or fail is a deterministic text or numeric comparison.

**Layer 1, deterministic extractors.** Regex plus real parsers for the atom kinds that have
a canonical form: money, numbers, dates, emails, URLs, identifiers, quoted spans. Upgrades
needed over what exists today:

- dates through a real date library with locale and format awareness, not two regexes
- money with currency-symbol and ISO-code normalisation, and a words-to-number pass
  ("two thousand pounds")
- identifiers matched as a whole token so the tail is never left behind as a stray number

**Layer 2, candidate entities.** A small local NER model proposes proper names, product
names, organisations and claims. This is allowed because it only proposes candidates; each
candidate is still checked against the source deterministically. If the model is wrong, the
worst case is a candidate that trivially matches or trivially does not, and the
deterministic check is the backstop.

**Layer 3, claim decomposition.** Break a sentence into atomic factual claims
("the balance is X", "it is due on Y"). Approach: dependency parse plus rules first, a
small fine-tuned extractor later. A claim is `violated` only when its atoms are present in
the source but not near each other, or an atom is absent. Entailment judgement by a large
model is explicitly out of scope, because that is the circular method again.

### 6.2 Presence matching, upgraded

| atom kind | match rule |
| --- | --- |
| number, money, date, identifier, email, URL | exact after normalisation |
| quoted span | token sequence match, ignoring punctuation and line breaks |
| proper name | token overlap plus bounded edit distance |
| claim | all atoms present, and relationship words within a co-occurrence window |

### 6.3 The golden corpus

A growing set of real task batches, anonymised, with human labels for every atom and every
task. Every check runs against it in CI. A release that drops precision below a set
threshold on this corpus does not ship. Precision and recall are published openly, because
the honesty is the marketing.

Adversarial fixtures are part of the corpus by design: planted fabrications, planted facts
that happen to also appear in the source, near-miss numbers, unicode, right-to-left text,
non-English answers, and correct answers with a trailing full stop after a URL.

---

## 7. Surfaces

### 7.1 CLI

The on-ramp. `silentgreen check` runs the worked example. `silentgreen check tasks.jsonl`
runs the user's own export. Zero config, no account, no key. Output is a plain report that
leads with the coverage-honesty sentence.

### 7.2 Dashboard

Pipeline health over time. Verdict trend lines. A list of what is `unproven` and the one
sentence saying what is missing for each. No vanity charts.

### 7.3 Review queue

The confirmation gate, and the soul of the product. For each expectation awaiting
confirmation it shows: the expectation, its basis, the evidence, the window being claimed,
and a text field for the attestation. The field rejects shrugs (minimum length, minimum
distinct words, not in a stock non-answer list), and the same validation runs server side,
not just in the browser.

### 7.4 Task inspector

One task, side by side: the answer on the left with every atom highlighted, the source on
the right, green for grounded, red for absent, with the reason under each red one.

### 7.5 CI annotations

A GitHub Action that comments on a PR: "this change alters the prompt for `billing-agent`;
3 confirmed checks are now stale and need re-confirmation before this merges."

### 7.6 Alerts

Slack, Discord, Teams, generic webhook, email. Delivery failures are returned to the
caller, never swallowed. Text first, link second.

### 7.7 API

Everything the dashboard does, over REST, with an API key. This is what agencies build on.

---

## 8. Security, privacy, tenancy

AI output and source documents contain personal data. This is a liability surface and it is
designed for, not bolted on.

- **Free tier stores verdicts and redacted evidence only.** Redacted evidence keeps the
  atom kind, the match result, and character offsets, not the personal value. A reviewer
  sees "a money atom at offset 214 is absent from the source", not the customer's balance.
- **Bring-your-own-storage option.** The engine runs in the customer's environment and
  pushes only verdicts to the hosted dashboard.
- **Paid tiers** may opt into full evidence retention with an explicit TTL (7, 30, 90 days)
  and encryption at rest.
- **Tenancy**: organisation, then project, then pipeline. Roles: viewer, reviewer (can pass
  the confirmation gate), admin.
- No customer data is ever sent to a third-party model. The NER and decomposition models
  are local.

---

## 9. Phased roadmap

Each phase has a shipping gate. Nothing in a phase is called done until it has run against
real batches that neither the builder nor a fixture author wrote.

### Phase 0: make the base honest

- [done] Remove the NUL bytes from the landing page and the stray committed file.
- [done] Build the golden-corpus harness: `silentgreen eval` scores every check against a
  labelled corpus, task by task, with the false-positive count on faithful answers as the
  gate. Wired into CI. Five synthetic batches to start (billing-support, faithful-adversarial,
  fabrication-adversarial, degenerate-and-deferral, inconclusive).
- [done] First extraction hardening pass driven by the corpus: reformatted dates
  (`03/11/2026` equals `2026-11-03`, ambiguous readings both accepted), quotations matched
  whole so a number inside one is not carved out, prompt-only grounding downgraded from
  fabrication to unproven.
- [open] Split the repo: an OSS core that runs fully offline, and a hosted service that
  depends on it. Decide the public name and domain.
- [open] Load the first 3 real batches from design partners and let them replace the
  synthetic fixtures. Until then every eval number means "the engine does what its author
  intended", not "the engine is correct".

### Phase 1: the honest OSS core

- [done] Internal-consistency check: subtotal plus tax against the stated total, a figure
  restated with a different value, a percentage that does not match its amount, a due date
  before the issue date. No source and no model needed. Stands down when the answer itself
  mentions a shipping line or a discount that would bridge the sum.
- [done] Structural-conformance check: JSON wrapped in prose, truncated JSON, prose where
  JSON was asked for, a ragged markdown table. Stays quiet on ordinary prose that happens
  to contain a brace.
- [in progress] Harden extraction: dates and quotations done; still to do are
  words-to-number, currency-code normalisation, fuzzy name matching.
- [open] Real reporting from `check`, leading with the coverage-honesty sentence.
- [done] Importers: JSONL, JSON array, and LangSmith and Langfuse trace shapes unpacked automatically. CSV still to do.
- [done] GitHub Action (`action.yml`) that runs `check` over a path or glob and comments
  the result on the PR, failing the job when an answer is flagged. `check` now takes
  multiple paths and expands `*`, `?` and `**`.
- [open] Publish precision and recall on the golden corpus in the README.

### Phase 2: the hosted free tier

**Status.** apps/api scaffolded (Express, Drizzle, Better Auth, ingest, ledger)
and apps/web scaffolded (Next.js, the marketing site with a 3D hero, the
session-gated dashboard with org/project/key creation). Both typecheck and
build. Not yet deployed: needs a live Neon URL and the Railway and Vercel
projects. The task inspector and session-auth batch drill-down are the next
build items.

**Infrastructure, decided.**

| piece | choice | why |
| --- | --- | --- |
| API host | Railway | the engine already runs as a Node service; matches the builder's existing stack |
| Web host | Vercel | Next.js App Router for the heavy 3D marketing site plus the app shell |
| Database | Neon Postgres | serverless, branchable, same stack the builder already runs |
| Auth | Better Auth | a library, not a service. Identity lives in Neon, not a vendor cloud, which is the only posture consistent with a product that tells agencies their evidence stays theirs. First-party `organization` and `apiKey` plugins cover orgs, members, roles, invitations and org-owned keys with rate limiting and expiry. SSO is a plugin when the agency tier needs it, or WorkOS bolted on for connections only. |
| ORM | Drizzle | TypeScript-native, light, has a Better Auth adapter, migrations run from the API service |

**Repo shape.** The root stays the OSS engine and CLI package, unchanged, so
`npx github:harsh01369/silentgreen` keeps working. It gains an `exports` map so the
engine is importable as a library. Two app packages sit alongside:

```
silentgreen/
  src/  test/  dist/        the engine and CLI, the npm package (unchanged)
  action.yml  docs/         the GitHub Action, the current static site
  apps/
    api/                    Express on Railway. depends on the engine by file ref.
    web/                    Next.js on Vercel.
```

**Database schema.**

- Better Auth tables: `user`, `session`, `account`, `verification`, `organization`,
  `member`, `invitation`, `apikey`.
- `project` (orgId, name, slug)
- `batch` (projectId, source, taskCount, uploadedAt, uploadedBy)
- `task_result` (batchId, taskId, verdict, atomsChecked, at)
- `problem` (taskResultId, kind, summary, evidenceRedacted, offsets). On the free tier
  `evidenceRedacted` keeps the atom kind, the match result and character offsets, never the
  personal value.
- `ledger_entry` (projectId, seq, hash, prevHash, payload, at) - the hash chain from
  `src/ledger/chain.ts`, moved into Postgres, one chain per project.

**API surface (v1).**

- `POST /v1/batches` - API key auth. Runs the engine, stores results and a ledger entry,
  returns the summary. This is the whole product for a developer: one call.
- `GET /v1/projects/:id/summary` - verdict counts and trend.
- `GET /v1/batches/:id` and `/v1/batches/:id/tasks/:taskId` - the task inspector data.
- Session-auth routes behind these for the dashboard.

**Deployment.** Railway builds `apps/api`, env `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`. Vercel builds `apps/web`, env `NEXT_PUBLIC_API_URL`. Drizzle migrations
run on API deploy against the Neon branch for the environment.

**Order of build.** schema and migrations, then Better Auth wired to Neon, then
`POST /v1/batches` with an API key, then the dashboard read paths, then the task inspector,
then the marketing site. The 3D frontend is a parallel track with its own design pass.

### Phase 3: the review queue and contracts

- The contract DSL, loader and validator.
- Inference of a first-draft contract from a batch.
- Structure-contract inference and diffing.
- The review queue UI and the server-side attestation validation.
- The alert state machine and the Slack integration.

### Phase 4: automation pipelines

- n8n connector and Make connector.
- Workflow semantic hashing: cosmetic edits (rename, move, note, colour) versus semantic
  edits (rewire, parameter, type version, disabled, credential type).
- Cadence and absence detection with the confirmation gate.
- The "your change made this stale" CI comment.

### Phase 5: the agency tier

- Roles and per-project permissions.
- Retention tiers and TTL controls.
- SSO, audit export, billing.
- On-prem or private-cloud deployment for larger agencies.

### Phase 6: the compliance surface

- Evidence export shaped for the EU AI Act and ISO 42001 obligations that land on anyone
  putting AI decisions in front of customers in 2026. This is where the agency urgency and
  the willingness to pay concentrate.

---

## 10. Business model

| | Free forever | Team and Agency |
| --- | --- | --- |
| CLI and OSS core | yes | yes |
| Hosted projects | 1 | unlimited |
| Tasks per month | a fixed allowance | unlimited |
| Tier 0 and Tier 1 checks | yes | yes |
| Contracts and the review queue | read only | full |
| CI integration | yes | yes |
| Connectors | LangSmith, Langfuse, file | all, plus priority on new ones |
| Evidence retention | verdicts plus redacted | full, with TTL choice |
| Alerts | webhook | Slack, Teams, email, webhook |
| Roles and SSO | no | yes |
| Audit and compliance export | no | yes |
| Support | community | direct, with a response commitment |

The free tier is the distribution. It has to be genuinely useful on its own, because the
people who later pay are the ones who first ran `check` on a Tuesday and it caught
something real.

---

## 11. How progress stays factually grounded

- No verdict without a basis. Observation verdicts are visually distinct until confirmed.
- Every verdict carries its literal evidence in an append-only, hash-chained log.
- Every report leads with a sentence stating what the green results can and cannot prove.
- A precision budget on the golden corpus gates every release.
- The golden corpus grows with real, labelled, anonymised batches, and includes
  adversarial fixtures on purpose.
- Checks are versioned; history is never silently rewritten.
- The product is dogfooded on the automation repo's own AI output.
- Claims in the README that are still fixtures are labelled as fixtures until a real batch
  replaces them.

---

## 12. Metrics

**Product.** Tasks verified, pipelines connected, problems caught that had reached
production, precision and recall on the golden corpus, time from install to first verdict.

**Business.** Free organisations, activated organisations (connected a real pipeline),
free to paid conversion, agency seats, revenue.

Impressions, stars and page views are not on this list.

---

## 13. Risks and how each is handled

| risk | handling |
| --- | --- |
| extraction is brittle, false positives kill it on first contact | precision budget, bias to silence, `unproven` over a guess |
| the market believes an LLM judge is good enough | publish the failure data, make the demo undeniable, be the tool that says `unproven` |
| PII liability | redact by default on free, bring-your-own-storage option, no third-party models |
| scope sprawl across RAG, agents, automations, code | the task abstraction is shared; be excellent at one vertical first (support agents and RAG), expand after |
| solo, part-time, builder leaving the UK end of 2026 | OSS core that survives without a company; hosted tier only if design partners pull it into existence |
| no real usage data yet | Phase 0 gate: 3 real batches before anything else; every phase gated on real batches |

---

## 14. Immediate next actions

1. ~~Clean the base: NUL bytes, stray file.~~ Done.
2. ~~Stand up the golden-corpus harness.~~ Done, in CI, five synthetic batches, gate green.
3. Repo split (OSS core vs hosted) and the name and domain decision.
4. Find 5 to 10 design partners running AI pipelines and get one real export from each.
5. Harden the extraction layer against that real data, then start Phase 2.

---

## 15. Open structural questions

These change the architecture and are not yet resolved in the plan above.

### 15.1 Synchronous gate vs asynchronous monitoring

Everything above assumes verification runs on a batch after it happened. The higher-value
mode for an agency is an inline gate that blocks a fabricated answer before it reaches the
customer. That needs sub-second latency, a middleware or proxy integration, and a
fail-open-or-closed policy the customer sets. It is a distinct surface. Decision needed
before Phase 2, because it shapes the ingestion API.

### 15.2 Append-only ledger vs the right to erasure

The evidence ledger is hash-chained and tamper-evident. Evidence contains personal data.
A deletion request cannot remove a link from a hash chain without breaking it. The
resolution is crypto-shredding: store each evidence blob encrypted under a per-subject key,
delete the key on request, keep the chain and the verdict intact. This needs to be designed
in from the first hosted schema, not retrofitted.

### 15.3 Why this is not a feature Langfuse ships next quarter

The defensible core is not the groundedness check, which anyone can copy. It is the
discipline around it: three verdicts with `unproven` as a first-class result, the basis
tag on every expectation, the confirmation gate that refuses a shrug, and an evidence
record built to be forwarded to a client or an auditor. An observability vendor whose
business is dashboards is structurally unlikely to ship a product that says "this cannot be
proven" as often as this one will. That posture is the moat, and it has to be visible in
every surface.

### 15.4 How observation baselines are actually computed

Tier 4 leans on learned baselines and the plan describes them in one line. The real design
covers the window length, seasonality (weekday and hour), how much history is enough before
a baseline is offered, how drift thresholds are set, and how a baseline is retired when the
underlying system changes. This is a subsystem and needs its own section before Phase 4.

### 15.5 Capacity

The builder is solo, part-time, and leaving the UK at the end of 2026. The six-phase plan
is realistically more than two years at that rate. The honest scoping: Phase 0 and Phase 1
produce an OSS tool that stands on its own and survives without a company. Phases 2 onward
happen only if design partners pull them into existence. The plan should not pretend
otherwise.
