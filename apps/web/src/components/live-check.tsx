'use client';

import { useMemo, useState, useId } from 'react';
import demo from '@/data/demo.json';

/**
 * The exhibit, live. An answer a support agent produced with an invoice in
 * front of it, and the invoice. One control: the way the pipeline recorded it,
 * or checked against the source. When it is checked, every fact that appears
 * nowhere is marked, drawn on left to right, with a note in the margin.
 *
 * No model was consulted to produce any of this.
 */
export function LiveCheck() {
  const [checked, setChecked] = useState(false);
  const runId = useId();

  const parts = useMemo(() => {
    const spans = [...demo.invented].sort((a, b) => b.text.length - a.text.length);
    let acc: { t: string; bad: boolean }[] = [{ t: demo.answer, bad: false }];
    for (const s of spans) {
      const next: typeof acc = [];
      for (const p of acc) {
        if (p.bad) {
          next.push(p);
          continue;
        }
        const i = p.t.indexOf(s.text);
        if (i === -1) {
          next.push(p);
          continue;
        }
        next.push({ t: p.t.slice(0, i), bad: false }, { t: s.text, bad: true }, { t: p.t.slice(i + s.text.length), bad: false });
      }
      acc = next;
    }
    let bi = 0;
    return acc.filter((p) => p.t.length > 0).map((p) => ({ ...p, idx: p.bad ? bi++ : -1 }));
  }, []);

  const invoiceMarked = useMemo(() => markInvoice(demo.invoice), []);

  return (
    <div className="glass overflow-hidden rounded-[22px] p-1.5">
      <div className="rounded-[16px] bg-[rgba(18,20,25,0.5)] p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 pb-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-halo-faint">
            Exhibit A &mdash; billing support, one answer
          </p>
          <div className="inline-flex rounded-lg border border-white/12 p-0.5 font-mono text-xs">
            <button
              onClick={() => setChecked(false)}
              aria-pressed={!checked}
              className={`rounded-md px-3 py-1.5 transition-colors ${!checked ? 'bg-white/10 text-halo' : 'text-halo-soft hover:text-halo'}`}
            >
              as recorded
            </button>
            <button
              onClick={() => setChecked(true)}
              aria-pressed={checked}
              className={`rounded-md px-3 py-1.5 transition-colors ${checked ? 'bg-white/10 text-halo' : 'text-halo-soft hover:text-halo'}`}
            >
              checked against the source
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-halo-faint">The answer</span>
              <span className={`font-mono text-xs ${checked ? 'text-absent' : 'text-halo-faint'}`}>
                {checked ? 'violated' : 'pipeline: resolved'}
              </span>
            </div>
            <p className="mt-3 font-mono text-[13.5px] leading-[1.95] text-halo sm:text-[14.5px]">
              {parts.map((p, i) =>
                p.bad && checked ? (
                  <span key={`${runId}-${i}`}>
                    <mark className="wipe-on mark-absent" style={{ animationDelay: `${p.idx * 80}ms` }}>
                      {p.t}
                    </mark>
                    <sup className="ml-0.5 font-sans text-[10px] text-absent">{p.idx + 1}</sup>
                  </span>
                ) : (
                  <span key={`${runId}-${i}`}>{p.t}</span>
                ),
              )}
            </p>

            {checked && (
              <ol className="mt-5 space-y-2 border-l border-absent/40 pl-4">
                {demo.invented.map((v, i) => (
                  <li
                    key={v.text}
                    className="wipe-on text-[13px] leading-snug text-halo-soft [overflow-wrap:anywhere]"
                    style={{ animationDelay: `${120 + i * 70}ms` }}
                  >
                    <span className="mr-1 font-mono text-absent">{i + 1}.</span>
                    <span className="font-mono text-halo">{v.text}</span>
                    <span> &mdash; {kindNote(v.kind)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-halo-faint">The invoice it was given</span>
            <pre className="glass-quiet mt-3 overflow-x-auto whitespace-pre-wrap p-4 font-mono text-[12px] leading-relaxed text-halo-soft">
              {invoiceMarked.map((seg, i) =>
                seg.hit && checked ? (
                  <mark key={i} className="rounded-sm bg-traced/20 px-0.5 text-traced" style={{ boxShadow: 'inset 0 -2px 0 var(--color-traced)' }}>
                    {seg.t}
                  </mark>
                ) : (
                  <span key={i}>{seg.t}</span>
                ),
              )}
            </pre>
          </div>
        </div>

        <p className="mt-6 border-t border-white/8 pt-4 font-display text-[15px] italic text-halo-soft">
          {checked
            ? `${demo.invented.length} facts in this answer appear nowhere in the invoice. No model was asked whether the answer looked right. The verdict is the invoice.`
            : 'Fluent, polite, booked as a resolved ticket. Every automated quality check it was put through passed.'}
        </p>
      </div>
    </div>
  );
}

function markInvoice(text: string): { t: string; hit: boolean }[] {
  const targets = ['£571.00', '£114.20', '£685.20', '2026-09-13', 'accounts@fernweh.example'];
  const re = new RegExp(`(${targets.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
  const out: { t: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ t: text.slice(last, m.index), hit: false });
    out.push({ t: m[0], hit: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ t: text.slice(last), hit: false });
  return out;
}

function kindNote(kind: string): string {
  const m: Record<string, string> = {
    email: 'an address that is nowhere in the invoice',
    money: 'an amount that is nowhere in the invoice',
    date: 'a date that is nowhere in the invoice',
    url: 'a link that is nowhere in the invoice',
    identifier: 'an identifier that is nowhere in the invoice',
  };
  return m[kind] ?? 'not found in the invoice';
}
