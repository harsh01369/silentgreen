import Link from 'next/link';
import { LedgerSceneLazy } from '@/components/ledger-scene-lazy';
import { LiveCheck } from '@/components/live-check';
import { Reveal, RevealStagger, CountUp, HeroParallax } from '@/components/motion-bits';

export default function Home() {
  return (
    <div className="relative">
      <Nav />
      <HeroParallax>
        <Hero />
      </HeroParallax>
      <ExhibitBand />

      <div className="on-paper relative z-10">
        <NoPass />
        <Register />
        <Method />
        <HowItWorks />
        <CTA />
      </div>

      <Footer />
    </div>
  );
}

/* ------------------------------------------------------------------- nav -- */

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto mt-3 flex max-w-6xl items-center justify-between rounded-full border border-white/10 bg-black/30 px-5 py-2.5 backdrop-blur-xl">
        <span className="font-mono text-[15px] font-medium tracking-tight text-halo">silentgreen</span>
        <nav className="flex items-center gap-5 font-sans text-sm text-halo-soft">
          <a href="#verdicts" className="hidden transition-colors hover:text-halo sm:inline">
            How it reads
          </a>
          <a href="https://github.com/harsh01369/silentgreen" className="transition-colors hover:text-halo">
            Source
          </a>
          <Link
            href="/login"
            className="rounded-full border border-white/15 px-4 py-1.5 text-halo transition-colors hover:border-traced hover:text-traced"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ hero -- */

function Hero() {
  return (
    <section className="grain relative flex min-h-[100svh] items-center overflow-hidden">
      <div data-hero-scene className="pointer-events-none absolute inset-0">
        <LedgerSceneLazy />
      </div>
      {/* dark on the copy side, clear on the scene side */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, var(--color-void) 0%, var(--color-void) 22%, rgba(10,11,13,0.55) 46%, rgba(10,11,13,0) 68%)',
        }}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-void/40 via-transparent to-void" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-void to-transparent" />

      <div data-hero-copy className="relative z-10 mx-auto w-full max-w-6xl px-6">
        <div className="max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-traced">Verification for AI work</p>
          <h1 className="mt-5 font-display text-[2.6rem] font-medium leading-[1.05] tracking-[-0.02em] text-halo sm:text-6xl lg:text-[4.2rem]">
            Nobody checked whether the AI did the job.
          </h1>
          <p className="mt-6 max-w-xl font-sans text-lg leading-relaxed text-halo-soft">
            silentgreen reads what an agent, a RAG pipeline or an automation produced and tells you what it can
            prove, what it can disprove, and what cannot be settled either way. It never asks a model to grade a
            model.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="glass-quiet rounded-xl px-4 py-3 font-mono text-sm text-halo">
              npx github:harsh01369/silentgreen check
            </code>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-xl bg-traced px-5 py-3 font-sans text-sm font-medium text-void transition-transform hover:scale-[1.02] active:scale-100"
            >
              Start free
            </Link>
          </div>
          <p className="mt-4 font-mono text-xs text-halo-faint">
            no account, no key. runs a worked example over twenty support answers, the invoice in front of them.
          </p>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-7 left-1/2 -translate-x-1/2 font-mono text-[10px] uppercase tracking-[0.3em] text-halo-faint">
        scroll
      </div>
    </section>
  );
}

function ExhibitBand() {
  return (
    <section className="relative bg-void pb-32 pt-32 sm:pt-36">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <p className="text-center font-mono text-[11px] uppercase tracking-[0.22em] text-halo-faint">the exhibit</p>
          <h2 className="mx-auto mt-4 max-w-2xl text-center font-display text-[1.7rem] font-medium leading-tight tracking-[-0.01em] text-halo sm:text-[2.1rem]">
            One answer, checked against its source. Not against another model.
          </h2>
        </Reveal>
        <Reveal delay={0.1} className="mt-14">
          <LiveCheck />
        </Reveal>
      </div>
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-36"
        style={{ background: 'linear-gradient(to bottom, rgba(10,11,13,0) 0%, rgba(10,11,13,0.7) 30%, var(--color-paper) 100%)' }}
      />
    </section>
  );
}

/* -------------------------------------------------------------- verdicts -- */

const VERDICTS = [
  {
    key: 'proven',
    tone: 'text-traced-deep',
    body: 'A confirmed, non-stale expectation was evaluated against real captured output, and it held. The evidence is text the model did not write.',
  },
  {
    key: 'violated',
    tone: 'text-absent-deep',
    body: 'A figure, a date, a link or a name in the answer appears nowhere in the material it was given. Or the answer is empty, refused, unrendered, deferred, or contradicts itself.',
  },
  {
    key: 'unproven',
    tone: 'text-withheld',
    body: 'The evidence to decide is not there. Sources were not captured, the check went stale when the pipeline changed, or there were too few checkable facts. It is never coloured green and it never raises an alert.',
  },
];

function NoPass() {
  return (
    <section id="verdicts" className="border-t border-rule">
      <div className="mx-auto max-w-5xl px-6 py-24 sm:py-28">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">§1 the verdicts</p>
          <h2 className="mt-3 max-w-[24ch] font-display text-3xl font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[2.6rem]">
            There is no <span className="line-through decoration-absent decoration-2">pass</span>. There are three
            verdicts.
          </h2>
          <p className="mt-4 max-w-[54ch] font-sans text-ink-soft">
            Every check returns one of these. The third is the one the rest of this market folds into a green
            tick, and it is the reason this one exists.
          </p>
        </Reveal>

        <RevealStagger className="mt-14 space-y-5" gap={0.12}>
          {VERDICTS.map((v) => (
            <div key={v.key} className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-7">
              <span
                className={`stamp inline-block shrink-0 px-3.5 py-1.5 text-sm ${v.tone}`}
                style={{ transform: 'rotate(-1.5deg)' }}
              >
                {v.key}
              </span>
              <p className="max-w-[58ch] font-sans text-[15px] leading-relaxed text-ink-soft">{v.body}</p>
            </div>
          ))}
        </RevealStagger>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- register -- */

const FINDINGS: [string, string][] = [
  ['fabricated fact', 'A number, amount, date, email, link, identifier, quotation or name in the answer that is traced to the source material, or reported.'],
  ['unrendered output', 'A template that never filled in. A refusal carried downstream as content. A raw error string in a field that should hold an answer.'],
  ['deferral as resolution', 'An agent that hands every hard case to a human and books it as done. A 96 percent resolution rate with nothing resolved.'],
  ['self-contradiction', 'A subtotal and tax that do not reach the stated total. Two figures for the same thing. A due date before the issue date.'],
  ['broken structure', 'JSON wrapped in an apology, truncated mid-object, or replaced with prose. A table whose rows disagree on column count.'],
  ['facts wired up wrong', 'An amount taken from one invoice and a due date from another, when both strings are present in the source. Atom checking misses this; this does not.'],
  ['the pipeline stalled', 'One answer returned for many different questions, which is what a pipeline looks like when it stopped reading its input.'],
];

function Register() {
  return (
    <section className="border-t border-rule">
      <div className="mx-auto max-w-5xl px-6 py-24 sm:py-28">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">§2 the register</p>
          <h2 className="mt-3 font-display text-3xl font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[2.6rem]">
            What a green tick hides
          </h2>
        </Reveal>
        <RevealStagger className="mt-12 divide-y divide-rule border-y border-rule" gap={0.06}>
          {FINDINGS.map(([term, def]) => (
            <div key={term} className="grid gap-1.5 py-5 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-8">
              <div className="font-mono text-[13px] text-ink">{term}</div>
              <p className="max-w-[56ch] font-sans text-[15px] leading-relaxed text-ink-soft">{def}</p>
            </div>
          ))}
        </RevealStagger>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- method -- */

function Method() {
  return (
    <section className="border-t border-rule">
      <div className="mx-auto max-w-5xl px-6 py-24 sm:py-28">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">§3 the method</p>
          <h2 className="mt-3 max-w-[22ch] font-display text-3xl font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[2.6rem]">
            Why not just have a model check the model
          </h2>
        </Reveal>

        <div className="mt-12 grid gap-12 lg:grid-cols-[1.1fr_0.9fr]">
          <Reveal className="max-w-[58ch] space-y-4 font-display text-[1.1rem] leading-[1.75] text-ink-soft">
            <p>
              Because that is marking homework with the same pen. Judges score their own family&rsquo;s output
              higher. Top-tier judges fail to hold a consistent preference on roughly a quarter of hard cases
              under repeated scoring.
            </p>
            <blockquote className="border-l-2 border-traced/60 pl-4 text-ink">
              One 2026 post-mortem: agents &ldquo;learned to produce confident-sounding but factually incorrect
              responses because the evaluation framework couldn&rsquo;t distinguish between confident correctness
              and confident fabrication.&rdquo;
            </blockquote>
            <p>
              So silentgreen asks a smaller question that has an answer. Not <em>is this good</em>, but{' '}
              <span className="text-ink">does every checkable fact appear in the material the model was given</span>
              . No model is consulted, which is exactly why the verdict can be trusted about a model.
            </p>
          </Reveal>

          <Reveal delay={0.1} className="flex flex-col justify-center gap-8 border-l border-rule pl-8">
            <div>
              <div className="font-display text-6xl font-medium text-ink">
                <CountUp to={50} suffix="%+" />
              </div>
              <p className="mt-2 max-w-[26ch] font-sans text-sm text-ink-soft">
                error rate for LLM judges on bias probes in production, against roughly 80 percent agreement in a
                controlled test.
              </p>
            </div>
            <div>
              <div className="font-display text-6xl font-medium text-ink">
                <CountUp to={0} />
              </div>
              <p className="mt-2 max-w-[26ch] font-sans text-sm text-ink-soft">
                models consulted by silentgreen to decide a verdict. Every verdict is a text or numeric
                comparison.
              </p>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ how it works -- */

const STEPS: [string, string][] = [
  ['record', 'Wrap the call your agent already makes, or drop a LangSmith / Langfuse / OpenTelemetry export in. One JSON object per task: what was asked, what it was given, what came back.'],
  ['check', 'silentgreen extracts every checkable atom and traces it to the source. It reports fabrications, unrendered output, deferrals booked as resolutions, contradiction and broken structure. Local, in CI, or push a batch to the API.'],
  ['forward', 'It writes a self-contained evidence record: the coverage statement, the findings, and a hash computed from the batch and the check versions. The document you hand to a client or an auditor.'],
];

function HowItWorks() {
  return (
    <section className="border-t border-rule">
      <div className="mx-auto max-w-5xl px-6 py-24 sm:py-28">
        <Reveal>
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-faint">§4 the loop</p>
          <h2 className="mt-3 font-display text-3xl font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[2.6rem]">
            Record, check, forward
          </h2>
        </Reveal>
        <RevealStagger
          className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-rule bg-rule sm:grid-cols-3"
          gap={0.1}
        >
          {STEPS.map(([name, body], i) => (
            <div key={name} className="bg-paper-raised p-7">
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-ink-faint">{String(i + 1).padStart(2, '0')}</span>
                <span className="font-mono text-sm text-traced-deep">{name}</span>
              </div>
              <p className="mt-3 font-sans text-sm leading-relaxed text-ink-soft">{body}</p>
            </div>
          ))}
        </RevealStagger>
      </div>
    </section>
  );
}

function CTA() {
  return (
    <section className="border-t border-rule">
      <div className="mx-auto max-w-5xl px-6 py-24 text-center sm:py-32">
        <Reveal>
          <h2 className="mx-auto max-w-[20ch] font-display text-3xl font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[2.8rem]">
            Point it at the last batch you shipped. See what it catches.
          </h2>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <code className="panel-sunken rounded-xl px-4 py-3 font-mono text-[13px] text-ink">
              npx github:harsh01369/silentgreen check
            </code>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-xl bg-ink px-5 py-3 font-sans text-sm font-medium text-paper transition-transform hover:scale-[1.02] active:scale-100"
            >
              Create a hosted project
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="bg-void">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-12 font-mono text-xs text-halo-faint sm:flex-row sm:items-center sm:justify-between">
        <span>silentgreen &mdash; the verdict is the invoice</span>
        <div className="flex gap-6">
          <a href="https://github.com/harsh01369/silentgreen" className="hover:text-halo-soft">
            GitHub
          </a>
          <Link href="/signup" className="hover:text-halo-soft">
            Start free
          </Link>
        </div>
      </div>
    </footer>
  );
}
