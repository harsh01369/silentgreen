import Link from 'next/link';
import { LiveCheck } from '@/components/live-check';

export default function Home() {
  return (
    <div className="min-h-[100dvh]">
      <Masthead />
      <Hero />
      <NoPass />
      <Register />
      <Judge />
      <Start />
      <Colophon />
    </div>
  );
}

/**
 * A section with a document margin. The margin carries a short note that points
 * at the body; on a narrow screen it stacks above as plain small text.
 */
function Section({
  id,
  note,
  children,
  className = '',
}: {
  id?: string;
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={`border-t border-rule ${className}`}>
      <div className="mx-auto max-w-4xl px-6 py-14 md:py-16">
        <div className="grid gap-x-10 gap-y-3 md:grid-cols-[10rem_minmax(0,1fr)]">
          <div className="font-mono text-[11px] leading-relaxed text-ink-faint">
            {note}
          </div>
          <div>{children}</div>
        </div>
      </div>
    </section>
  );
}

function Masthead() {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <span className="font-mono text-[15px] font-medium tracking-tight text-ink">
          silentgreen
        </span>
        <nav className="flex items-center gap-6 font-sans text-sm text-ink-soft">
          <a href="#verdicts" className="hover:text-ink">
            How it reads
          </a>
          <a href="https://github.com/harsh01369/silentgreen" className="hover:text-ink">
            Source
          </a>
          <Link href="/login" className="text-stamp hover:underline">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section>
      <div className="mx-auto max-w-4xl px-6 pb-14 pt-12 md:pt-16">
        <div className="grid gap-x-10 gap-y-5 md:grid-cols-[10rem_minmax(0,1fr)]">
          <div className="font-mono text-[11px] leading-relaxed text-ink-faint">
            verification for
            <br />
            AI &amp; automation
          </div>
          <div>
            <h1 className="max-w-[20ch] font-serif text-[2.1rem] font-medium leading-[1.12] tracking-[-0.01em] text-ink sm:text-[2.7rem]">
              Nobody checked whether the AI did the job.
            </h1>
            <p className="mt-5 max-w-[54ch] font-serif text-[1.05rem] leading-relaxed text-ink-soft">
              silentgreen reads what an agent, a RAG pipeline or an automation produced and
              tells you what it can prove, what it can disprove, and what cannot be settled
              either way. It never asks a model to grade a model.
            </p>
          </div>
        </div>

        <div className="mt-10">
          <LiveCheck />
        </div>
      </div>
    </section>
  );
}

const VERDICTS = [
  {
    key: 'proven',
    tone: 'text-traced',
    gloss:
      'A confirmed, non-stale expectation was evaluated against real captured output, and it held. The evidence is text the model did not write.',
  },
  {
    key: 'violated',
    tone: 'text-absent',
    gloss:
      'A figure, a date, a link or a name in the answer appears nowhere in the material it was given. Or the answer is empty, refused, unrendered, deferred, or contradicts itself.',
  },
  {
    key: 'unproven',
    tone: 'text-withheld',
    gloss:
      'The evidence to decide is not there. Sources were not captured, the check went stale when the pipeline changed, or there were too few checkable facts. It is never coloured green and it never raises an alert.',
  },
];

function NoPass() {
  return (
    <Section id="verdicts" note="§1 · the verdicts">
      <h2 className="max-w-[24ch] font-serif text-[1.7rem] font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[2rem]">
        There is no <span className="line-through decoration-absent decoration-2">pass</span>.
        There are three verdicts.
      </h2>
      <p className="mt-4 max-w-[56ch] font-serif text-ink-soft">
        Every check returns one of these. The third is the one the rest of this market
        folds into a green tick, and it is the reason this one exists.
      </p>

      <div className="mt-10 space-y-4">
        {VERDICTS.map((v) => (
          <div key={v.key} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
            <span
              className={`stamp inline-block shrink-0 px-3 py-1 text-sm ${v.tone}`}
              style={{ transform: 'rotate(-1.5deg)' }}
            >
              {v.key}
            </span>
            <p className="max-w-[58ch] font-serif text-[15px] leading-relaxed text-ink-soft">
              {v.gloss}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

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
    <Section note="§2 · the register">
      <h2 className="font-serif text-[1.7rem] font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[2rem]">
        What a green tick hides
      </h2>
      <dl className="mt-9 divide-y divide-rule border-y border-rule">
        {FINDINGS.map(([term, def]) => (
          <div key={term} className="grid gap-1 py-4 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-6">
            <dt className="font-mono text-[13px] text-ink">{term}</dt>
            <dd className="max-w-[56ch] font-serif text-[15px] leading-relaxed text-ink-soft">{def}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function Judge() {
  return (
    <Section note="§3 · the method">
      <h2 className="max-w-[22ch] font-serif text-[1.7rem] font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[2rem]">
        Why not just have a model check the model
      </h2>
      <div className="mt-6 max-w-[60ch] space-y-4 font-serif text-[1.05rem] leading-[1.75] text-ink-soft">
        <p>
          Because that is marking homework with the same pen. Judges score their own
          family&rsquo;s output higher. Top-tier judges fail to hold a consistent preference
          on roughly a quarter of hard cases under repeated scoring. Agreement that looks
          like 80 percent in a controlled test collapses past 50 percent error on bias
          probes in production.
        </p>
        <blockquote className="border-l-2 border-stamp/50 pl-4 text-ink">
          One 2026 post-mortem: agents &ldquo;learned to produce confident-sounding but
          factually incorrect responses because the evaluation framework couldn&rsquo;t
          distinguish between confident correctness and confident fabrication.&rdquo;
        </blockquote>
        <p>
          So silentgreen asks a smaller question that has an answer. Not{' '}
          <span className="italic">is this good</span>, but{' '}
          <span className="text-ink">does every checkable fact in the answer appear in
          the material the model was given</span>. No model is consulted, which is exactly
          why the verdict can be trusted about a model.
        </p>
      </div>
    </Section>
  );
}

function Start() {
  return (
    <Section note="§4 · run it">
      <h2 className="font-serif text-[1.7rem] font-medium leading-tight tracking-[-0.01em] text-ink sm:text-[2rem]">
        One command, no account
      </h2>
      <p className="mt-4 max-w-[54ch] font-serif text-ink-soft">
        Runs a worked example over twenty support answers with the invoice in front of them.
        Point it at your own JSONL, CSV, or a LangSmith, Langfuse or OpenTelemetry export
        when you are ready.
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <code className="panel-sunken rounded px-4 py-3 font-mono text-[13px] text-ink">
          npx github:harsh01369/silentgreen check
        </code>
        <Link
          href="/signup"
          className="inline-flex items-center justify-center rounded border border-stamp px-4 py-3 font-mono text-[13px] text-stamp transition-colors hover:bg-stamp hover:text-ground-raised"
        >
          create a hosted project
        </Link>
      </div>
    </Section>
  );
}

function Colophon() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-4xl flex-col gap-3 px-6 py-10 font-mono text-xs text-ink-faint sm:flex-row sm:items-center sm:justify-between">
        <span>silentgreen &mdash; the verdict is the invoice</span>
        <div className="flex gap-6">
          <a href="https://github.com/harsh01369/silentgreen" className="hover:text-ink-soft">
            GitHub
          </a>
          <Link href="/signup" className="hover:text-ink-soft">
            Start free
          </Link>
        </div>
      </div>
    </footer>
  );
}
