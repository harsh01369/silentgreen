# silentgreen

**Verification for AI work, that never asks a model to grade a model.**

```
npx github:harsh01369/silentgreen check
```

No account, no API key, no signup. That runs a worked example over twenty answers from a
support agent that had the invoice in front of it, and shows you the ones it invented.

---

## Why not just use an LLM judge

Because that is marking homework with the same pen, and the 2026 literature on it is not
kind. Judges score their own family's output higher. Top-tier judges fail to hold a
consistent preference on roughly a quarter of hard cases under repeated scoring. Agreement
that looks like 80% in a controlled test collapses past 50% error on bias probes in
production.

From a 2026 post-mortem, describing the failure precisely:

> agents "learned to produce confident-sounding but factually incorrect responses because
> the evaluation framework couldn't distinguish between confident correctness and confident
> fabrication."

So silentgreen asks a smaller question that has an actual answer. Not *is this good*, but
**does every checkable fact in the answer appear in the material the model was given**.
Numbers, money, dates, emails, links, identifiers, quoted passages and proper names either
occur in the source or they do not. No model is consulted, which is exactly why the verdict
can be trusted about a model.

It also catches what a scorer waves through: an unrendered template that shipped to a
customer, a refusal carried downstream as content, an agent that hands every hard case back
to a human and books it as resolved, and one answer returned for twenty different questions
because the pipeline stopped reading its input.

### On your own work

```bash
npx github:harsh01369/silentgreen check tasks.jsonl
```

One JSON object per line. Field names are flexible, because every tool in this space calls
these things something different:

```json
{"id": "t1", "input": "...", "sources": ["..."], "output": "..."}
```

`output` / `response` / `answer` / `completion`, and `sources` / `context` / `documents` /
`retrieved`. Documents may be strings or objects. Lines that cannot be read are reported
rather than silently dropped, because a parser that quietly discards a third of the file and
then reports no problems would be an unusually poor joke in this particular codebase.

**LangSmith, Langfuse and OpenTelemetry exports work as they are.** A LangChain run with
`inputs` and `outputs` objects, generations nested two arrays deep, and the retrieved
documents sitting in a child retriever run is unpacked automatically. So is a Langfuse trace
with singular `input` / `output` and the retrieval step as an observation. So is an
OpenTelemetry GenAI span, in any of the key styles the convention has churned through
(`gen_ai.input.messages` / `gen_ai.output.messages`, the deprecated `gen_ai.prompt` /
`gen_ai.completion`, the OpenLLMetry `gen_ai.prompt.0.content` flattening, the
OpenInference `llm.input_messages.0.message.content` flattening, Traceloop entity
input/output), which between them covers OpenLLMetry / Traceloop, Arize / Phoenix, MLflow
and more. Dump your runs to JSONL and pass the file. If a trace has no recoverable answer
it is reported, never dropped.

**Or record as you go.** Instead of exporting after the fact, wrap the call your agent
already makes:

```ts
import { createRecorder } from 'silentgreen/record';

const sg = createRecorder({ sink: 'silentgreen.jsonl' });     // or { url, apiKey }

const answer = await sg.task({ input: question }, async (t) => {
  const docs = await retrieve(question);
  t.source(docs.map((d) => d.text));
  const out = await llm(question, docs);
  t.action({ kind: 'email.sent', target: customer.email });   // optional
  return out;                                                  // captured as the output
});

await sg.flush();
```

No dependencies, and the body's return value passes straight through, so the wrapper is
transparent.

### A contract, when a linter is not enough

`check` needs nothing configured. A contract is the first thing you write down: a short file
that says what the pipeline is actually for, so the verdict is about the job and not only
the text.

```bash
silentgreen contract tasks.jsonl > billing.sg.yaml   # draft one from a batch
silentgreen check tasks.jsonl --contract billing.sg.yaml
```

```yaml
pipeline: billing-support-agent
basis: intent
attests: "Harsh, 2026-09, these rules are what the agent is contracted to do"

output:
  must_contain:
    - kind: money        # every answer quotes an amount
    - kind: date         # and a due date
  must_not_contain:
    - pattern: "refund|credit note"
  grounded:
    kinds: [money, date, identifier, email, url]
  predicates:
    - "money <= source.money.max"       # never quote more than the source shows
    - "date within 90 days"
    - "currency == source.currency"

actions:
  - when: "emailed|sent you the invoice"
    require:
      kind: email.sent
      target_matches: source.email      # and it went to the address in the source
```

Every clause is a deterministic comparison and returns one of the three verdicts. The
`attests` line is mandatory and is printed next to every result the contract produces. If
the answer claims an action but no actions were recorded, the clause is `unproven`, not
`violated`, because a gap in the evidence is not proof of a lie.

### What the worked example finds

Twenty answers. Every one was recorded as a completed task, and every one reads as helpful.

```
  7 of 20 answers (35%) contain something the pipeline reported as a success.

  clean         13
  problems       7
  inconclusive   0

    4  facts absent from the source material
    2  empty, unrendered or refused
    1  handed the task back instead of doing it
    3  the same answer across different tasks
```

Thirteen faithful answers, none of them accused. That ratio matters more than the catches:
an early version of this flagged fourteen correct answers because the URL pattern swallowed
the full stop at the end of a sentence. A tool that cries fabrication at correct work is
finished on first contact with a user.

### What it deliberately does not tell you

Whether the answer is wise, complete or appropriate. A clean result is not a claim that the
work was good. It is a narrower promise than the rest of this market makes, and it is one
that can be kept.

### How the checks are scored

```
npm run dev -- eval
```

Every check runs against a labelled corpus and the result is scored task by task. The
metric that gates a change is not accuracy, it is the count of faithful answers wrongly
flagged, which must be zero. A change that improves recall but flags one correct answer
fails.

| batch | tasks | precision | recall | false positives |
| --- | --- | --- | --- | --- |
| billing-support | 20 | 1.00 | 1.00 | 0 |
| faithful-adversarial | 11 | 1.00 | 1.00 | 0 |
| fabrication-adversarial | 9 | 1.00 | 1.00 | 0 |
| degenerate-and-deferral | 6 | 1.00 | 1.00 | 0 |
| self-contradiction | 7 | 1.00 | 1.00 | 0 |
| structured-output | 5 | 1.00 | 1.00 | 0 |
| inconclusive | 3 | 1.00 | 1.00 | 0 |
| **overall** | **61** | **1.000** | **1.000** | **0** |

**This number is worth very little on its own, and the plan says so.** The corpus is
entirely synthetic. It was written to pin down intended behaviour, including adversarial
cases (a transposed figure, a date written day-first, a quotation repunctuated, a name that
opens a sentence, a currency named as a code, an amount within a rounding of the real one),
so 1.000 means the engine behaves the way its author meant and nothing stronger. It becomes
evidence when real, third-party batches replace the fixtures. That swap is tracked as the
first item in [SYSTEM-PLAN.md](SYSTEM-PLAN.md), and until it happens the honest reading of
this table is "no known false positive", not "no false positives".

---

## The same failure, in automations

A workflow fails the way an answer does: it reports success, and the work did not happen.

## The problem, stated precisely

A workflow fetches orders, maps some fields, writes rows to Postgres and emails the
customer. One day the upstream API renames `customer_email` to `customerEmail`. The
mapping step now resolves to null. Postgres accepts the null. The email step sends
`Hi {{ $json.firstName }}` to a real person.

Every one of those runs returns HTTP 200. The platform records them as successes. The
row count does not change, so an anomaly detector sees nothing. Nobody finds out until a
customer complains or someone opens the table by hand.

From the n8n community, unprompted, in a thread about managing automations for several
clients:

> "A client's data-exchange queue grew silently for months because the receiving side
> never confirmed anything. **Every run 'green', nobody looked.**"

The name of this project is that sentence.

## What it does

Four things, none of which an error-driven monitor can do:

**Verifies output against a contract.** Not "did it throw" but "did it produce the thing
it exists to produce". Empty results, missing fields, nulls where values belong,
unrendered `{{ }}` templates, model refusals carried downstream as if they were content,
`[object Object]`, stack traces sitting in a value.

**Detects absence.** A scheduled workflow that stops firing writes no execution and
raises no error, so there is nothing for an event-driven monitor to react to. This one
carries a clock. It also discounts nights and weekends, because an alarm that fires at
02:00 on a Saturday for a workflow that runs 09:00 to 17:00 on weekdays gets muted within
a fortnight, and a muted alarm is worse than none because it is believed to be working.

**Goes stale rather than rotting.** Every contract is bound to a semantic hash of the
workflow. Renaming a node or dragging it across the canvas changes nothing. Rewiring a
connection, changing a request target, bumping a node version or disabling a step
invalidates every check bound to it, and those checks then report `unproven` instead of
continuing to report green about a graph that no longer exists.

**Produces evidence.** A hash-chained ledger of what was checked, what was caught, and
who confirmed each expectation, exportable as a document you can hand to the person
paying the invoice.

## The part that is actually different

Every workflow monitor learns a baseline from history and alerts on deviation. That
catches change. It cannot catch a workflow that has been quietly wrong since the day it
shipped, because the wrongness is *in* the baseline.

The same community thread worked this out in public:

> "Canaries that derive expected answers from system output prove only internal
> consistency, not correctness."
>
> "Non-circular expectations must come from business stakeholders **before**
> implementation, not derived from test data afterward."

So every expectation here carries the basis it came from, and the rules differ by basis:

| Basis | Where it came from | A green result proves | It does not prove |
|---|---|---|---|
| `intent` | A person said what the workflow is for | It is doing the job somebody said it was for | That the stated job is still the job the business needs |
| `structure` | The workflow definition itself | It is doing what its own definition says | That the definition was ever correct |
| `observation` | Its own execution history | Behaviour has not changed since an attested window | That behaviour in that window was correct |

An `observation` expectation **cannot become a live check** until a named person states
which window they believe was good and how they know. "Reconciled against the client's
invoice export for March" is an attestation. "Looks fine" is refused, and the tool says
why. Whatever they write is printed in the report next to every green tick it produces,
which is a stronger incentive than validation.

Reports state which of the three bases their coverage rests on. If every live check is
`observation`, the report says so in plain English: this shows the workflow has not
changed, and nothing here shows it was ever right.

## There is no pass

Three verdicts, and the middle one is the point:

- **proven** — a confirmed, non-stale expectation was evaluated against real captured
  output and held.
- **violated** — it did not hold, and the literal captured value that decided it is
  quoted. If the evidence cannot be shown, the accusation is not made.
- **unproven** — this was not established, with the reason: no expectation exists, one
  exists but is unconfirmed, it went stale when the workflow changed, or the platform did
  not retain the output.

There is no code path that turns silence into a pass. A tool that reports "0 problems"
while quietly meaning "we checked nothing" has the same defect as the workflows it is
watching.

## What the demo prints

Six weeks, 207 executions, one upstream rename on day 22, and the workflow deactivated
on day 31 and never turned back on.

```
What the platform tells you
  207 executions, 207 successful, 0 failed.

Verifying six weeks of runs against those contracts
  63 of 207 runs (30%) produced output that violated a confirmed expectation,
  while the platform recorded 0 failures.

  proven    1737
  violated  127
  unproven  0

What was caught (3 distinct problems)
  x Every item from "Insert into orders" carries "order_id", "customer_email", "total", "synced_at"
    63 run(s), first at 2026-07-28 09:00
    Item 0 has field "customer_email" but its value is null.
    captured: {"order_id":"ORD-22-9-0","customer_email":null,"total":161.59, ...}

  x Text from "Send confirmation" is never empty, unrendered or an error string
    63 run(s), first at 2026-07-28 09:00
    Item 0, field "body" still contains an unrendered template expression, so a value
    was never substituted in. Also affected in the same run: "to" (null-literal).
    captured: Hi {{ $json.firstName }}, your order is confirmed. Total: {{ $json.total }}

  x This workflow runs at least every 60 minutes
    Last run was 11 days ago (2.7 days of working time, once hours it never runs in
    are discounted). Nothing has failed, because nothing has run.
```

And then, to show that checks go stale rather than rotting, the same contracts against
the same executions after one node is edited:

```
  proven    0     (was 1737)
  violated  0     (was 127)
  unproven  1864  (was 0)
```

Nothing turned green, and nothing kept accusing.

## The loop

```bash
# 1. load the worked example into a local store, or scan a real instance
npx github:harsh01369/silentgreen seed
#   ...or:
export N8N_URL=https://your-n8n.example
export N8N_API_KEY=n8n_api_...        # Settings, n8n API. Read access is enough.
npx github:harsh01369/silentgreen scan

# 2. confirm or refuse what it proposed, in a local review queue
npx github:harsh01369/silentgreen review        # http://127.0.0.1:4666

# 3. check recent runs against what you confirmed
npx github:harsh01369/silentgreen verify        # exits 1 on a violation, so cron works
npx github:harsh01369/silentgreen watch         # or keep it running, and alert on change

# 4. produce the record you can forward
npx github:harsh01369/silentgreen report --out record.html
```

### Alerting

Absence detection needs a clock, so `watch` is one. It re-checks on an interval and tells
somebody when the answer changes.

```bash
export SILENTGREEN_SLACK_WEBHOOK=https://hooks.slack.com/services/...
export SILENTGREEN_DISCORD_WEBHOOK=...     # or Teams, or a generic JSON webhook
npx github:harsh01369/silentgreen watch --interval 300
```

The part that matters is when it stays quiet:

- A **new** failure alerts once, with the statement, the detail and the captured value.
- The **same** failure does not alert again for 24 hours, because the third identical
  message is what teaches somebody to filter the channel, and a filtered channel is worse
  than no alerting: everybody believes they are covered.
- **Recovery** alerts once, because "it is fixed" is information.
- **`unproven` never alerts.** A check going stale is a coverage gap for the review queue,
  not an incident for somebody's evening. Nor does it close an open one: losing sight of a
  problem is not the same as fixing it.
- A **delivery failure is printed and written to the ledger**. A rotated webhook that now
  returns 404 must not leave the tool reporting that somebody was told, which would be this
  product's own subject matter one level up.

`watch` also states on startup how many checks are actually live, and says plainly when the
answer is none, rather than printing a reassuring `0 violated` forever.

`scan` reads your workflows and recent executions, works out where output leaves the
system, and proposes expectations with the basis and reasoning for each. Nothing it
proposes can raise anything until you confirm it.

`review` is where that happens. It shows the real captured values an expectation will be
judging, what a green result there does and does not prove, and for anything learned from
history, the attestation box. That box is validated by the same function the gate uses
rather than a copy of its rules in the browser, so the interface cannot promise something
the gate will refuse.

Re-running `scan` after somebody edits a workflow stales every confirmed expectation bound
to the old revision, records what moved, and those checks then report `unproven` until a
person re-reads them.

### Where state lives

A `.silentgreen/` directory beside wherever you run it:

```
.silentgreen/state.json     workflows, expectations, confirmations. Plain JSON.
.silentgreen/ledger.jsonl   append-only, hash-chained evidence log.
```

Readable, diffable, committable, deletable. If you remove it you lose the history of what
was confirmed and nothing else breaks. Use `--store DIR` to put it somewhere else.

**It is read-only.** There is no code path in this tool that writes to, activates,
deactivates or deletes anything on your instance. A tool whose job is to tell you the
truth about your automations should not be able to become the reason they broke.

Credentials are never read: the tool looks at which *credential type* a node uses, because
swapping Postgres for Airtable is a change to the graph, and never at the credential itself.

## In CI

There is a GitHub Action. It runs `check` over an export and comments the result on the
pull request, failing the job when an answer is flagged.

```yaml
- uses: harsh01369/silentgreen@main
  with:
    file: traces/*.jsonl        # a path or a glob
    fail-on-problem: true       # set false to comment only
```

`check` itself takes one or more paths and expands `*`, `?` and `**`:

```bash
npx github:harsh01369/silentgreen check "traces/**/*.jsonl"
```

## Install

```bash
npx github:harsh01369/silentgreen demo    # nothing to install
```

Node 20 or newer. Installing from git rather than the registry for now, because the
package is not published yet and pointing you at a name that does not resolve would be a
poor first impression from a tool about unverified claims. When it lands on npm this
becomes `npx silentgreen`.

## What this does not do

- It cannot tell you a workflow is *correct* unless somebody states what it is for. Most
  contracts it proposes are `structure` or `observation`, and it labels them rather than
  letting them imply more than they earned.
- It only sees what your platform retained. If execution data is pruned, checks report
  `unproven` rather than passing.
- Absence detection on an irregular, event-driven trigger is noisy. It tells you the
  confidence is low and suggests a volume expectation over a day instead, rather than
  handing you an alarm you will mute.
- The evidence ledger is a hash chain in a file you control. It makes accidental
  corruption, editing and deletion detectable. It is not a claim against a determined
  operator who owns the file, and is not presented as one.
- There is no hosted service. The tool is complete for self-hosting, and everything an
  earlier version of the landing page advertised at 29 pounds a month now ships free,
  because charging for it while it did not exist would have been this project's own
  argument used against it.
- Make.com support is a connector away: the verification core is platform-agnostic and
  the Make API exposes scenarios, logs and per-execution detail. It is not written yet.

## Development

```bash
npm install
npm test          # 167 tests
npm run check     # tsc --noEmit
npx tsx src/cli.ts demo
```

The core is pure and exhaustively tested: `contract/circularity.ts` is the confirmation
gate, `graph/hash.ts` decides what counts as a meaningful change, `verify/assert.ts`
evaluates expectations, `verify/cadence.ts` handles absence.

Bugs found by testing this thing rather than trusting it, all of them the tool's own
subject matter:

1. Cadence inference counted overnight and weekend gaps as rhythm, producing "runs at
   least every 16 hours" for a workflow that runs hourly. An expectation that loose would
   not have noticed a full day of silence.
2. A cadence expectation was not bound to a workflow revision, so it kept firing against a
   graph it was never confirmed for. It is stale like everything else now.

The most useful contribution would be an execution export where it misses a real defect,
or one where it flags something correct. Both go straight into the test corpus.

## Licence

MIT.
