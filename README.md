# silentgreen

**Your automation platform reports that the code ran. It cannot report whether the work happened.**

```
npx github:harsh01369/silentgreen demo
```

No account, no API key, no signup. That command runs a worked example against six weeks
of execution history and prints what the platform saw next to what actually happened.

---

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

## Against your own instance

```bash
export N8N_URL=https://your-n8n.example
export N8N_API_KEY=n8n_api_...        # Settings, n8n API. Read access is enough.
npx github:harsh01369/silentgreen scan
```

`scan` reads your workflows and recent executions, works out where output leaves the
system, and proposes contracts with the basis and reasoning for each. Nothing it proposes
can raise an alert until you confirm it.

**It is read-only.** There is no code path in this tool that writes to, activates,
deactivates or deletes anything on your instance. A tool whose job is to tell you the
truth about your automations should not be able to become the reason they broke.

Credentials are never read: the tool looks at which *credential type* a node uses, because
swapping Postgres for Airtable is a change to the graph, and never at the credential itself.

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
- Make.com support is a connector away: the verification core is platform-agnostic and
  the Make API exposes scenarios, logs and per-execution detail. It is not written yet.

## Development

```bash
npm install
npm test          # 98 tests
npm run check     # tsc --noEmit
npx tsx src/cli.ts demo
```

The core is pure and exhaustively tested: `contract/circularity.ts` is the confirmation
gate, `graph/hash.ts` decides what counts as a meaningful change, `verify/assert.ts`
evaluates expectations, `verify/cadence.ts` handles absence.

Two bugs the worked example found in this tool's own code, both of which were the tool's
own subject matter:

1. Cadence inference counted overnight and weekend gaps as rhythm, producing "runs at
   least every 16 hours" for a workflow that runs hourly. An expectation that loose would
   not have noticed a full day of silence.
2. A cadence expectation was not bound to a workflow revision, so it kept firing against a
   graph it was never confirmed for. It is stale like everything else now.

The most useful contribution would be an execution export where it misses a real defect,
or one where it flags something correct. Both go straight into the test corpus.

## Licence

MIT.
