import Link from 'next/link';
import { HeroScene } from '@/components/hero-scene-lazy';

export default function Home() {
  return (
    <main className="relative">
      <SiteNav />
      <Hero />
      <NoPass />
      <Catches />
      <NotAJudge />
      <SiteFoot />
    </main>
  );
}

function SiteNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <span className="font-display text-lg tracking-tight text-paper">
          silent<span className="text-patina-bright">green</span>
        </span>
        <nav className="flex items-center gap-6 text-sm text-paper-dim">
          <a href="#verdicts" className="transition-colors hover:text-paper">
            How it works
          </a>
          <a href="https://github.com/harsh01369/silentgreen" className="transition-colors hover:text-paper">
            Source
          </a>
          <Link
            href="/login"
            className="rounded-full border border-line-bright px-4 py-1.5 text-paper transition-colors hover:border-patina hover:text-patina-bright"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative flex min-h-[100dvh] items-center overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <HeroScene />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink via-ink/70 to-transparent md:to-transparent lg:via-ink/40" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-ink to-transparent" />

      <div className="relative z-10 mx-auto w-full max-w-6xl px-6">
        <div className="max-w-2xl">
          <p className="mb-5 text-sm text-patina">Verification for AI work</p>
          <h1 className="font-display text-5xl font-medium leading-[1.04] tracking-tight text-paper sm:text-6xl">
            Nobody checked whether the AI did the job.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-paper-dim">
            silentgreen reads the output of an agent, a RAG pipeline or an automation and tells you what it can
            prove, what it can disprove, and what cannot be proven either way. It never asks a model to grade a
            model.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="glass-quiet rounded-lg px-4 py-3 font-mono text-sm text-paper">
              npx github:harsh01369/silentgreen check
            </code>
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-lg bg-patina px-5 py-3 text-sm font-medium text-ink-sunken transition-colors hover:bg-patina-bright"
            >
              Start free
            </Link>
          </div>

          <p className="mt-4 font-mono text-xs text-paper-faint">
            no account, no API key. runs a worked example over twenty support answers with the invoice in front
            of them.
          </p>
        </div>
      </div>
    </section>
  );
}

const VERDICTS = [
  {
    key: 'proven',
    tone: 'text-patina-bright',
    ring: 'border-patina/40',
    body: 'A confirmed, non-stale expectation was evaluated against real captured output, and it held. The evidence is in text the model did not write.',
  },
  {
    key: 'violated',
    tone: 'text-amber',
    ring: 'border-amber/40',
    body: 'A figure, a date, a link or a name in the answer appears nowhere in the material it was given. Or the answer is empty, refused, unrendered, deferred, or contradicts itself.',
  },
  {
    key: 'unproven',
    tone: 'text-slate-verdict',
    ring: 'border-slate-verdict/40',
    body: 'The evidence to decide is not there. Sources were not captured, the check went stale when the pipeline changed, or there were too few checkable facts. It is never coloured green and it never raises an alert.',
  },
];

function NoPass() {
  return (
    <section id="verdicts" className="relative border-t border-line py-28">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="max-w-2xl font-display text-3xl font-medium tracking-tight text-paper sm:text-4xl">
          There is no <span className="text-paper-faint line-through decoration-1">pass</span>. There are three
          verdicts.
        </h2>
        <p className="mt-4 max-w-xl text-paper-dim">
          Every check returns one of these. The third is the one the rest of this market collapses into a green
          tick, which is the reason this one exists.
        </p>

        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {VERDICTS.map((v) => (
            <div key={v.key} className={`glass rounded-2xl border p-6 ${v.ring}`}>
              <div className={`font-mono text-sm ${v.tone}`}>{v.key}</div>
              <p className="mt-3 text-sm leading-relaxed text-paper-dim">{v.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const CHECKS = [
  ['Fabricated facts', 'Every number, amount, date, email, link, identifier, quotation and name in the answer is traced to the source material, or reported.'],
  ['Unrendered output', 'A template that never filled in. A refusal carried downstream as content. A raw error string in a field that should hold an answer.'],
  ['Deferral as resolution', 'An agent that hands every hard case to a human and books it as done. A 96% resolution rate with nothing resolved.'],
  ['Self-contradiction', 'A subtotal and tax that do not reach the stated total. Two figures for the same thing. A due date before the issue date.'],
  ['Broken structure', 'JSON wrapped in an apology, truncated mid-object, or replaced with prose. A table whose rows disagree on column count.'],
  ['The pipeline stalled', 'One answer returned for many different questions, which is what a pipeline looks like when it stopped reading its input.'],
];

function Catches() {
  return (
    <section className="relative border-t border-line py-28">
      <div className="mx-auto max-w-6xl px-6">
        <h2 className="font-display text-3xl font-medium tracking-tight text-paper sm:text-4xl">
          What a green tick hides
        </h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {CHECKS.map(([title, body]) => (
            <div key={title} className="bg-ink-raised p-7">
              <h3 className="font-display text-lg text-paper">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-paper-dim">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function NotAJudge() {
  return (
    <section className="relative border-t border-line py-28">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[1fr_1.1fr]">
        <h2 className="font-display text-3xl font-medium leading-tight tracking-tight text-paper sm:text-4xl">
          Why not just use an LLM judge
        </h2>
        <div className="space-y-4 text-paper-dim">
          <p>
            Because that is marking homework with the same pen. Judges score their own family&rsquo;s output
            higher. Top-tier judges fail to hold a consistent preference on roughly a quarter of hard cases under
            repeated scoring. Agreement that looks like 80% in a controlled test collapses past 50% error on bias
            probes in production.
          </p>
          <p className="border-l-2 border-patina/50 pl-4 text-paper">
            One 2026 post-mortem: agents &ldquo;learned to produce confident-sounding but factually incorrect
            responses because the evaluation framework couldn&rsquo;t distinguish between confident correctness
            and confident fabrication.&rdquo;
          </p>
          <p>
            So silentgreen asks a smaller question that has an answer. Not <em>is this good</em>, but{' '}
            <span className="text-paper">does every checkable fact appear in the material the model was given</span>.
            No model is consulted, which is exactly why the verdict can be trusted about a model.
          </p>
        </div>
      </div>
    </section>
  );
}

function SiteFoot() {
  return (
    <footer className="border-t border-line py-14">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 text-sm text-paper-faint sm:flex-row sm:items-center sm:justify-between">
        <span className="font-display text-paper-dim">
          silent<span className="text-patina">green</span>
        </span>
        <div className="flex gap-6">
          <a href="https://github.com/harsh01369/silentgreen" className="hover:text-paper-dim">
            GitHub
          </a>
          <Link href="/signup" className="hover:text-paper-dim">
            Start free
          </Link>
        </div>
      </div>
    </footer>
  );
}
