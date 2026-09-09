# Launch

Everything here is ready to paste. Ordered by expected value.

The important difference from a cold launch: **people asked for this in public, recently,
and the threads are still open.** Answering a question that was actually asked is not
marketing, and it is the only channel here that starts with someone already looking for
the thing.

Two rules for every post below.

**Disclose that you built it, in the first or second sentence.** Every one of these
communities will forgive self-promotion attached to a real answer and will not forgive it
disguised as one. `revenuewithai` in the silent-failures thread discloses their product in
the same breath as their advice, and it reads as honest rather than promotional.

**Lead with the technical point, not the link.** If the comment would be worth reading
with the last line deleted, it is a good comment.

---

## Step 1: the n8n threads, in this order

### 1a. Silent Failures in Production (the deep one)

<https://community.n8n.io/t/silent-failures-in-production-how-do-you-handle-observability-global-error-handling-for-20-n8n-workflows/308805>

This is the highest-value post available anywhere, because the participants already
derived the core idea themselves and hit the wall this tool is built around. `Kacper1`
raised circular provenance. `Adam13y` proposed canaries. Nobody resolved it.

**Do not summarise the tool.** Answer Kacper's objection.

```
Kacper's point about circular provenance is the one that decided the design of
something I ended up building, so let me try to make it concrete rather than
philosophical.

The problem is not that learned baselines are useless. It is that a baseline
learned from output can only ever establish consistency, never correctness, and
almost every tool in this space presents the two as the same green tick. If a
workflow has been dropping 5% of rows since the day it shipped, a baseline
learned from its history ratifies the 5% as the standard. The alert you build on
top is then working perfectly and telling you nothing.

So I stopped treating "where the expectation came from" as metadata and made it
part of the type. Three bases:

  intent       a person said what the workflow is for
  structure    read from the workflow definition itself
  observation  learned from its own execution history

They confirm under different rules. An intent or structure expectation can be
confirmed by reviewing it. An observation expectation cannot become a live check
at all until someone names the window they believe was good and says how they
know it was good, in a sentence. "Reconciled against the client's invoice export
for March" passes. "Looks fine" is refused, with an explanation. Whatever they
write gets printed in the report next to every green tick it produces, which
turns out to be a much stronger filter than any validation rule.

That directly answers Adam's canary risk too: a canary whose expected answer is
derived from system output is an observation-basis check, and it is labelled as
one rather than quietly counted as proof.

The second thing that fell out of this thread was the staleness problem someone
described elsewhere as "the output check you write this week will be muted within
a month". Checks rarely get deleted, they get outlived. So every expectation is
bound to a semantic hash of the workflow: node ids, types, versions, parameters
and the connection topology, with positions and node names excluded. Renaming a
node or moving it on the canvas changes nothing. Rewiring, retargeting an HTTP
node, bumping a typeVersion or disabling a step invalidates every check bound to
it, and those then report "unproven" rather than continuing to report green about
a graph that no longer exists.

On the missing-scheduled-workflow point that revenuewithai raised: the hard part
was not the alarm, it was the false alarm. A workflow running 09:00-17:00 on
weekdays has a 16 hour gap every night and a 64 hour gap every weekend. My first
implementation learned "runs at least every 16 hours" from exactly that data,
which is an expectation so loose it would not have noticed a full day of outage.
Excluding intervals that cross non-working time gives "every 60 minutes" from the
same history, and the absence check then discounts nights and weekends before it
decides anything is wrong.

I have open-sourced it. Disclosure: I built it, and there is a paid hosted tier
planned, so weigh that accordingly.

  npx github:harsh01369/silentgreen demo

That runs a worked example with no credentials: six weeks of an order sync where
an upstream field gets renamed on day 22. 207 executions, all of them recorded as
successes by the platform, 63 of them writing nulls into Postgres and emailing
customers a literal "Hi {{ $json.firstName }}".

github.com/harsh01369/silentgreen

The thing I would genuinely value from this thread is an execution export where
it misses a real defect, or one where it flags something that was fine. Both go
straight into the test corpus, and the second kind is worth more.
```

### 1b. For those managing automations for 5+ clients

<https://community.n8n.io/t/for-those-managing-automations-for-5-clients-where-does-the-actual-time-go/309201>

`AleksGorbatov` said the thing every tool in this space needs tattooed somewhere:

> "They all wanted to become the system of record, and the boring file already is."

Answer that objection head-on, because the tool genuinely complies with it.

```
"They all wanted to become the system of record, and the boring file already is"
is the most useful sentence in this thread, and it is worth taking literally
rather than as a complaint about onboarding friction.

I built something in this space and that constraint shaped it more than any
feature request. It is read-only against the n8n API, it holds no credentials
beyond a read-scoped key, and it does not maintain a client roster, because your
file already does. What it keeps is an append-only log of what was checked, what
was caught, and who confirmed each expectation. If you delete it, you lose the
history and nothing else breaks.

The specific thing it is for is the failure Shubham and others describe here: a
run that is green and accomplished nothing. Not "did it throw", but "did it
produce the thing it exists to produce". Missing fields, nulls where values
belong, unrendered {{ }} templates that shipped to a customer, an AI step that
declined and passed its refusal downstream as content, and the workflow that
stopped firing entirely and therefore wrote no execution for anything to alert on.

The part relevant to the retainer question underneath this thread: it produces a
monthly record per client of what was verified and what was caught, including
what could not be established and why. That last section is the reason it exists.
A report full of green that quietly means "we checked nothing" is the same defect
as the workflows we are all trying to catch.

Disclosure: mine, open source, paid hosted tier planned.

  npx github:harsh01369/silentgreen demo

github.com/harsh01369/silentgreen
```

### 1c. The other three threads in the same queue

Search the n8n community for these and reply with a short, specific version of the
relevant argument above. Do not paste the long comment more than once.

- "How do you catch workflows that run fine but do nothing?"
- "The output check you write this week will be muted within a month" (this one is
  precisely the staleness argument, so lead with the semantic hash)
- "Best pattern for syncing n8n executions into an external proof and approval log?"
  (lead with the hash-chained ledger, and be honest about what a hash chain in a file
  you own does and does not prove)

---

## Step 2: Show HN

Post Tuesday to Thursday, 14:00-16:00 UTC. Link the repo, not the sales page.

**Title:**

```
Show HN: Your workflow ran successfully and did nothing. Here's how to catch that
```

**First comment, immediately after submitting:**

```
Every automation platform tells you whether the code ran. None of them tell you
whether the work happened, and the gap between those two is where a surprising
amount of production data quietly goes missing.

The worked example in the repo is a real pattern rather than a toy: an order sync
where the upstream API renames customer_email to customerEmail. The mapping step
resolves to null, Postgres accepts the null, and the email step sends
"Hi {{ $json.firstName }}" to actual customers. 207 executions, every one of them
recorded as a success, 63 of them wrong. Item volume never changes, so anomaly
detection sees nothing at all.

The design question that turned out to matter is not "what checks should we run"
but "where did the expectation come from". A baseline learned from a system's own
output can only ever prove it has not changed. If it was already broken, you have
just ratified the breakage. Every monitoring tool I looked at collapses that
distinction into one green tick.

So expectations carry their basis: stated intent, the workflow definition, or
observed history. An observation-basis expectation cannot become a live check
until a named person states which window they believe was correct and how they
know. "Looks fine" is refused. Whatever they write is printed in the report next
to every green tick it produces.

Three verdicts, and there is no "pass": proven, violated, and unproven with a
reason. Nothing turns silence into a green tick, which is the failure mode this
exists to catch and would be a bad one to reproduce.

Two bugs the worked example found in my own code, both of them the tool's own
subject matter. Cadence inference counted overnight and weekend gaps as rhythm and
produced "runs at least every 16 hours" for a workflow that runs hourly, which
would not have noticed a day of outage. And the cadence check was not bound to a
workflow revision, so it kept firing against a graph it was never confirmed
against. Both are in the commit log.

  npx github:harsh01369/silentgreen demo

No account, no key. Not on npm yet, hence the git install.

github.com/harsh01369/silentgreen

Most useful thing anyone could send me is an execution export where it misses a
real defect, or flags something that was fine.
```

**Expect two hard comments, and answer them first.**

*"This is just assertions with extra steps."* Yes, and the extra step is the entire
product: assertions nobody writes, that rot silently when the workflow changes, and that
launder a learned baseline as a standard. Point at the basis table.

*"Why not just use Sentry / Grafana / OpenTelemetry?"* All of them are excellent and all
of them are error-driven. None can catch a run that succeeded and wrote nulls, and none
can catch a workflow that stopped firing, because neither produces an event.

---

## Step 3: Make.com community

Their top thread right now is somebody hiring Make engineers at $75-95/hr, so there is
money moving through that forum. A Make connector is not written yet, so post honestly:

> The verification core is platform-agnostic and the Make API exposes scenarios, logs and
> per-execution detail, so the connector is a couple of days of work. Before I write it I
> would like to know whether the failure mode lands for Make users the way it does for
> n8n users. If it does, say so in this thread and I will build it next.

That is a genuine question, it is also the cheapest possible demand test, and it gives
anyone who answers a reason to come back.

---

## Step 4: the n8n community node

n8n's verified community nodes are discoverable from inside the editor's node panel,
which is real distribution rather than borrowed attention.

Constraints worth knowing before starting:

- No runtime dependencies allowed for verification. This bundle already has none.
- Package name must start with `n8n-nodes-`.
- Must use the `n8n-node` CLI, TypeScript, English only.
- From 1 May 2026, submissions must be published via GitHub Actions with a provenance
  statement.
- One third-party service per package, with an optional trigger node.

Ship it as `n8n-nodes-silentgreen`: a node that verifies a run against its confirmed
contract and fails loudly when the answer is "unproven". That makes the check live inside
the workflow rather than beside it, which is where these teams already work.

---

## Step 5: what to sell, honestly

State plainly what exists, because the alternative is selling a screenshot.

**Exists today:** the engine, the CLI, the evidence report, the read-only n8n connector.
It runs when you run it.

**Does not exist yet:** the hosted service. Absence detection genuinely needs a clock
somebody else is paying to keep running, which is exactly why it is the paid tier and
also why it cannot be sold before it is built.

So the honest first revenue is a service rather than a subscription:

- **Set-up engagement, £400 to £900.** Point it at an agency's instance, work through the
  proposal queue with them, get the first contracts confirmed with real attestations, hand
  over the first evidence report. This is billable now, needs no infrastructure, and every
  hour of it is direct research into what the hosted tier must do.
- **Monthly evidence record, £150 to £300 per client per month.** Runs the check, produces
  the document the agency forwards to the client. Manual to begin with, which is fine:
  doing it by hand is how you learn what to automate.
- Upwork and the Make forum both have buyers for this framing today. The positioning that
  nobody else there can claim: *I will show you which of your client automations are
  currently succeeding and doing nothing, and give you a record you can forward.*

The hosted tier gets built once somebody has paid for the manual version, not before.

---

## What honest success looks like

- **Week 1.** The threads are the whole game. A substantive reply in 1a is worth more than
  a front page that never converts, because everyone reading it has the problem today.
- **Weeks 2-6.** First paid set-up engagement, most likely from the n8n or Make forum
  rather than from HN.
- **The measurement that matters** is not stars. It is whether anyone runs `scan` against
  an instance we did not choose and comes back with output. That is the only evidence the
  problem is felt rather than merely real.

## Blocked on you

1. **npm publish.** `npm login && npm publish --access public`, or put `NPM_TOKEN=` in
   `.env` and I will do it. Not urgent any more: the git install works and is tested, so
   nothing below is blocked on it.
2. **Forum accounts.** community.n8n.io and community.make.com posts have to come from a
   real person with a history, and should.
3. **Stripe.** Only needed once someone wants to pay for the hosted tier, which is after
   the manual version has a customer.
