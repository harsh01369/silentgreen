'use client';

import { useMemo, useState } from 'react';
import demo from '@/data/demo.json';

/**
 * The fabrication demo, live. Left: an answer a support agent produced with an
 * invoice in front of it. Right: the invoice. Toggle between how the pipeline
 * recorded it (completed) and what the source actually supports.
 */
export function LiveCheck() {
  const [checked, setChecked] = useState(false);

  const marked = useMemo(() => {
    // Wrap each invented span. Longest first so a short atom inside a longer one
    // cannot split it.
    const spans = [...demo.invented].sort((a, b) => b.text.length - a.text.length);
    const parts: Array<{ t: string; bad: boolean }> = [{ t: demo.answer, bad: false }];
    for (const s of spans) {
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i]!;
        if (p.bad) continue;
        const idx = p.t.indexOf(s.text);
        if (idx === -1) continue;
        parts.splice(
          i,
          1,
          { t: p.t.slice(0, idx), bad: false },
          { t: s.text, bad: true },
          { t: p.t.slice(idx + s.text.length), bad: false },
        );
        break;
      }
    }
    return parts.filter((p) => p.t.length > 0);
  }, []);

  return (
    <section className="relative border-t border-line py-24">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-display text-3xl font-medium tracking-tight text-paper sm:text-4xl">
            One answer, checked against its source
          </h2>
          <div className="inline-flex rounded-lg border border-line-bright p-1 text-sm">
            <button
              onClick={() => setChecked(false)}
              aria-pressed={!checked}
              className={`rounded-md px-3 py-1.5 transition-colors ${!checked ? 'bg-paper/10 text-paper' : 'text-paper-dim'}`}
            >
              As the pipeline recorded it
            </button>
            <button
              onClick={() => setChecked(true)}
              aria-pressed={checked}
              className={`rounded-md px-3 py-1.5 transition-colors ${checked ? 'bg-paper/10 text-paper' : 'text-paper-dim'}`}
            >
              Checked against the source
            </button>
          </div>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <div className="glass rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-paper-faint">the answer</span>
              <span className={`font-mono text-xs ${checked ? 'text-amber' : 'text-patina-bright'}`}>
                {checked ? 'violated' : 'recorded as completed'}
              </span>
            </div>
            <p className="mt-4 leading-relaxed text-paper-dim">
              {marked.map((p, i) =>
                p.bad && checked ? (
                  <mark key={i} className="rounded bg-amber/20 px-0.5 text-amber decoration-amber/60 underline">
                    {p.t}
                  </mark>
                ) : (
                  <span key={i} className={p.bad && !checked ? 'text-paper-dim' : ''}>
                    {p.t}
                  </span>
                ),
              )}
            </p>
          </div>

          <div className="glass-quiet rounded-2xl p-6">
            <span className="font-mono text-xs text-paper-faint">the invoice it was given</span>
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-paper-dim">
              {demo.invoice}
            </pre>
          </div>
        </div>

        <div className="mt-4 glass-quiet rounded-2xl p-6" hidden={!checked}>
          <p className="text-sm text-paper">
            {demo.invented.length} of the facts in this answer appear nowhere in the invoice.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm text-paper-dim">
            {demo.invented.map((v) => (
              <li key={v.text}>
                <code className="font-mono text-amber">{v.text}</code> &mdash; {v.why}
              </li>
            ))}
          </ul>
          <p className="mt-4 font-mono text-xs text-paper-faint">
            no model was consulted. the verdict is the invoice.
          </p>
        </div>
      </div>
    </section>
  );
}
