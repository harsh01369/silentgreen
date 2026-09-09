# Launch

Everything here is ready to paste. Ordered by expected value.

The product is verification for AI work: it reads the output of an agent, a RAG pipeline or
an automation and never asks a model to grade a model. n8n is one connector, not the pitch.

Two rules for every post below.

**Disclose that you built it, in the first or second sentence.** Every community here will
forgive self-promotion attached to a real answer and will not forgive it disguised as one.

**Lead with the technical point, not the link.** If the comment would be worth reading with
the last line deleted, it is a good comment.

The one line: **it checks whether every checkable fact in an answer appears in the material
the model was given, with no model consulted, which is exactly why the verdict can be
trusted about a model.**

---

## The argument, in one paragraph

The standard way to check AI work is to ask another model whether the answer looks right.
The 2026 literature on that is not kind. Top judges score reliability of 45.7% on
reasoning, 54.5% on tool use, 47.5% on report quality. Same-verdict rate under repeated
scoring drops from 95% at temperature 0 to 70% at temperature 1. The small fine-tuned
groundedness models (Lynx, HHEM, Luna) do better, 85 to 90% agreement with humans, but
they are still probabilistic classifiers and they still fail silently. silentgreen asks a
smaller question that has an actual answer: does the figure, the date, the email, the link,
the identifier, the quotation, the name occur in the source or not. That is decided by the
source text, deterministically. It is a narrower promise than the rest of the market makes,
and it is one that can be kept.

---

## Step 1: Show HN

Post Tuesday to Thursday, 14:00 to 16:00 UTC. Link the repo.

**Title:**

```
Show HN: Verify AI output without asking a model to grade a model
```

**First comment, immediately after submitting:**

```
The standard way to check an LLM's work in production is to have another LLM
score it. The 2026 papers on that report judge reliability around 45 to 55% on
hard tasks, and a same-verdict rate that falls to 70% once you raise the
temperature. You are grading homework with the same pen.

So this asks a smaller question. Not "is the answer good", but "does every
checkable fact in it appear in the material the model was given". Numbers,
money, dates, emails, URLs, identifiers, quoted spans and proper names either
occur in the source or they do not. No model is consulted. The verdict is
decided by the source text, which is why it can be trusted about a model.

The worked example is a support agent answering billing questions with the
invoice in front of it. Twenty answers, every one recorded as a completed task,
every one reads as helpful. Thirteen are clean. Seven are caught: four with a
figure or a contact that is nowhere in the invoice, one unrendered template that
shipped, one refusal carried downstream as content, three identical answers to
different questions.

The number I care about more than the catches is the thirteen. An early version
flagged fourteen faithful answers because the URL pattern ate the full stop at
the end of a sentence. A tool that cries fabrication at correct work is finished
on first contact with a user, so there is a labelled corpus and a release does
not ship if it flags one faithful answer.

It also catches what a scorer waves through: an answer that contradicts itself
(a subtotal and tax that do not reach the stated total), JSON returned wrapped
in an apology or truncated mid-object, and an agent that defers every hard case
to a human and books it as resolved.

  npx github:harsh01369/silentgreen check

No account, no key. Reads JSONL, CSV, and LangSmith and Langfuse exports as they
are.

github.com/harsh01369/silentgreen

Disclosure: I built it, there is a hosted free tier and a paid agency tier, so
weigh that. The most useful thing anyone could send is a real batch of AI output
where it misses a fabrication, or flags something that was faithful. The second
kind goes straight into the corpus and is worth more.
```

**Expect these comments, and answer them first.**

*"Isn't this just a groundedness scorer?"* Those are fine-tuned models with 85 to 90%
human agreement, which means one in eight to one in ten verdicts is wrong and you cannot
tell which. This is deterministic atom matching: the same input gives the same verdict, and
the verdict is a statement about the source text, not a model's opinion of it. Narrower,
and checkable.

*"String matching will miss paraphrase and semantic equivalence."* Yes. It does not claim
to catch a wrong idea expressed in right numbers. It claims to catch the invented invoice
total, the fabricated contact, the transposed date, which is the failure that costs money.
A clean result is explicitly not a claim that the answer is good.

*"Why not an LLM judge on a sample plus this?"* That is a reasonable architecture and the
tool is built to be the deterministic half of it. Use a judge for taste. Use this for
whether the facts are real.

---

## Step 2: where the eval audience already is

These are GitHub Discussions and issues, not cold outreach. People are asking the exact
question this answers.

- **Ragas, DeepEval, promptfoo, Phoenix discussions** search each repo's Discussions for
  "faithfulness", "groundedness without LLM", "deterministic eval", "judge is flaky". Reply
  with the atom-matching approach and a link. Do not paste the same comment twice.
- **r/LLMDevs and r/MachineLearning** wait for a "how do you eval RAG in prod without it
  costing a fortune in judge calls" thread, which appears roughly weekly, and answer it.
  Needs a real account with history.
- **The LangChain and LlamaIndex forums** the retrieval-QA channels have a steady stream of
  "my agent confidently made up a number" posts. The demo answers that directly.
- **AI engineering newsletters** (Latent Space, the batch-eval writers) will look at a tool
  that takes a contrarian, well-tested position on the judge problem. Send the repo with
  the one-paragraph argument, not a pitch.

The framing that nobody else in that space leads with: *the verdict is not a model's
opinion. No model was asked.*

---

## Step 3: the n8n threads (n8n is a connector)

Still worth doing, because the participants derived the core idea themselves and hit the
wall the tool is built around. Lead with the AI-work framing and note the workflow
connector.

### 3a. Silent Failures in Production

<https://community.n8n.io/t/silent-failures-in-production-how-do-you-handle-observability-global-error-handling-for-20-n8n-workflows/308805>

`Kacper1` raised circular provenance. Answer that.

```
Kacper's point about circular provenance decided the design of something I
ended up building, so let me make it concrete.

A baseline learned from a system's output can only ever establish consistency,
never correctness. If a workflow has dropped 5% of rows since it shipped, a
baseline learned from its history ratifies the 5% as normal. Almost every tool
in this space presents consistency and correctness as the same green tick.

So expectations carry their basis: stated intent, the workflow definition, or
observed history. An observation-basis expectation cannot become a live check
until a named person states which window they believe was correct and how they
know, in a sentence. "Reconciled against the client's invoice export for March"
passes. "Looks fine" is refused. Whatever they write is printed next to every
green tick it produces.

The same engine now checks AI steps: does every figure, date and identifier in
the answer appear in the material the step was given, with no model asked. That
is the check the rest of this space cannot make honestly, because the standard
method is a second model.

  npx github:harsh01369/silentgreen demo      the workflow example
  npx github:harsh01369/silentgreen check     the AI-work example

Disclosure: mine, open source, hosted tier. The thing I would value from this
thread is an execution export where it misses a real defect, or flags one that
was fine.
```

### 3b. For those managing automations for 5+ clients

<https://community.n8n.io/t/for-those-managing-automations-for-5-clients-where-does-the-actual-time-go/309201>

Lead with the append-only record per client of what was checked, what was caught, and what
could not be established and why. `AleksGorbatov`: "they all wanted to become the system of
record, and the boring file already is." The tool complies: read-only, holds no roster,
keeps only the ledger.

### 3c. The other threads

Short, specific replies only. "How do you catch workflows that run fine but do nothing?",
"the output check you write this week will be muted within a month" (lead with the semantic
hash), "syncing n8n executions into an external proof and approval log" (lead with the
hash-chained ledger, and be honest about what a hash chain in a file you own proves).

---

## Step 4: the n8n community node

`n8n-nodes-silentgreen`: a node that verifies a step's output against its confirmed
contract and fails loudly on "unproven". Verified community nodes are discoverable from
inside the editor. Constraints: no runtime dependencies (this bundle has none), name starts
with `n8n-nodes-`, `n8n-node` CLI, English only, and from 1 May 2026 submissions publish
via GitHub Actions with a provenance statement.

---

## Step 5: what is free, what is paid

**Free forever:** the CLI and the OSS engine. One hosted project, a monthly task allowance,
every Tier 0 and Tier 1 check, the dashboard, the task inspector, the GitHub Action,
LangSmith and Langfuse import. This is the distribution. It has to be genuinely useful on
its own, because the people who later pay are the ones who ran `check` on a Tuesday and it
caught something real.

**Team and Agency:** unlimited projects and tasks, the contract DSL and the review queue,
roles, retention tiers with full encrypted evidence, Slack and email alerts, audit export.
Pricing decided once there is a real batch of usage to price against.

**Not sold yet:** anything that implies the review queue, the contract system, or SSO
exists before it does. The plan is in SYSTEM-PLAN.md and it is honest about the order.

---

## What honest success looks like

- **Week 1.** A substantive Show HN thread and three or four real answers in eval-tool
  discussions. Everyone reading them has the problem today.
- **Weeks 2 to 6.** First hosted signups that connect a real pipeline, not just sign up.
  The metric is activation, not registration.
- **The measurement that matters** is whether anyone runs `check` against a batch neither
  of us wrote and comes back with output. That is the only evidence the problem is felt
  rather than merely real.

## Blocked on you

1. **The three services.** Neon `DATABASE_URL`, a Railway project on `apps/api`, a Vercel
   project on `apps/web`. Then the hosted free tier is live and everything in Step 5 is
   real rather than planned.
2. **`BETTER_AUTH_SECRET`.** Generate one, or I will and you paste it into Railway.
3. **Forum and community accounts.** HN, Reddit and the n8n forum posts have to come from a
   real person with a history, and should.
4. **npm publish.** `npm publish --access public`, or put `NPM_TOKEN=` in `.env`. The git
   install works and is tested, so nothing here is blocked on it.
