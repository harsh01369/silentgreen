'use client';

import { useMemo, useState, useId } from 'react';
import demo from '@/data/demo.json';

/**
 * The exhibit.
 *
 * An answer a support agent produced with an invoice in front of it, and the
 * invoice. One control: show it the way the pipeline recorded it (a completed
 * task), or checked against the source. When it is checked, every fact that
 * appears nowhere in the invoice is marked, and a note in the margin says why.
 *
 * No model was consulted to produce any of this. The marks are string
 * comparisons against the invoice text, which is the whole point.
 */

type Part = { t: string; bad: boolean; idx: number };

export function LiveCheck() {
  const [checked, setChecked] = useState(false);
  const runId = useId();

  const parts = useMemo<Part[]>(() => {
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
        next.push({ t: p.t.slice(0, i), bad: false });
        next.push({ t: s.text, bad: true });
        next.push({ t: p.t.slice(i + s.text.length), bad: false });
      }
      acc = next;
    }
    let badIdx = 0;
    return acc
      .filter((p) => p.t.length > 0)
      .map((p) => ({ ...p, idx: p.bad ? badIdx++ : -1 }));
  }, []);

  const invoiceMarked = useMemo(() => markInvoice(demo.invoice), []);

  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-[10rem_minmax(0,1fr)]">
      {/* the reviewer's margin */}
      <aside className="order-2 space-y-6 md:order-1 md:pt-1">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">Verdict key</p>
          <ul className="mt-2 space-y-1.5 font-mono text-xs">
            <li className="text-traced">proven</li>
            <li className="text-absent">violated</li>
            <li className="text-withheld">unproven</li>
          </ul>
        </div>
        {checked && (
          <div className="hidden md:block">
            <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">Not in the invoice</p>
            <ol className="mt-2 space-y-3">
              {demo.invented.map((v, i) => (
                <li
                  key={v.text}
                  className="wipe-on text-xs leading-snug text-ink-soft [overflow-wrap:anywhere]"
                  style={{ animationDelay: `${120 + i * 70}ms` }}
                >
                  <span className="mr-1 font-mono text-absent">{i + 1}.</span>
                  <span className="font-mono text-ink">{v.text}</span>
                  <span className="text-ink-soft"> &mdash; {kindNote(v.kind)}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </aside>

      <div className="order-1 md:order-2">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-rule pb-3">
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
            Exhibit A &mdash; billing support, one answer
          </p>
          <div className="inline-flex overflow-hidden rounded border border-rule-strong font-mono text-xs">
            <button
              onClick={() => setChecked(false)}
              aria-pressed={!checked}
              className={`px-3 py-1.5 transition-colors ${!checked ? 'bg-ground-sunken text-ink' : 'text-ink-soft hover:text-ink'}`}
            >
              as recorded
            </button>
            <button
              onClick={() => setChecked(true)}
              aria-pressed={checked}
              className={`border-l border-rule-strong px-3 py-1.5 transition-colors ${checked ? 'bg-ground-sunken text-ink' : 'text-ink-soft hover:text-ink'}`}
            >
              checked against the source
            </button>
          </div>
        </div>

        {/* the answer */}
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">The answer</span>
            <span className={`font-mono text-xs ${checked ? 'text-absent' : 'text-ink-faint'}`}>
              {checked ? 'violated' : 'pipeline: resolved'}
            </span>
          </div>
          <p className="mt-3 font-mono text-[13.5px] leading-[1.95] text-ink sm:text-[15px] sm:leading-[1.9]">
            {parts.map((p, i) =>
              p.bad && checked ? (
                <span key={`${runId}-${i}`}>
                  <mark
                    className="wipe-on mark-absent"
                    style={{ animationDelay: `${p.idx * 70}ms` }}
                  >
                    {p.t}
                  </mark>
                  <sup className="ml-0.5 font-sans text-[10px] text-absent">{p.idx + 1}</sup>
                </span>
              ) : (
                <span key={`${runId}-${i}`} className={p.bad && !checked ? 'text-ink' : ''}>
                  {p.t}
                </span>
              ),
            )}
          </p>
        </div>

        {/* the source */}
        <div className="mt-6">
          <span className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
            The invoice it was given
          </span>
          <pre className="panel-sunken mt-3 overflow-x-auto whitespace-pre-wrap p-4 font-mono text-[13px] leading-relaxed text-ink-soft">
            {invoiceMarked.map((seg, i) =>
              seg.hit && checked ? (
                <mark key={i} className="mark-traced">
                  {seg.t}
                </mark>
              ) : (
                <span key={i}>{seg.t}</span>
              ),
            )}
          </pre>
        </div>

        {/* mobile notes */}
        {checked && (
          <ol className="mt-5 space-y-2 border-l-2 border-absent/40 pl-4 md:hidden">
            {demo.invented.map((v, i) => (
              <li key={v.text} className="text-sm text-ink-soft">
                <span className="mr-1 font-mono text-absent">{i + 1}.</span>
                <span className="font-mono text-ink">{v.text}</span> &mdash; {kindNote(v.kind)}
              </li>
            ))}
          </ol>
        )}

        <p className="mt-6 border-t border-rule pt-3 font-serif text-[15px] italic text-ink-soft">
          {checked
            ? `${demo.invented.length} facts in this answer appear nowhere in the invoice. No model was asked whether the answer looked right. The verdict is the invoice.`
            : 'Fluent, polite, and booked as a resolved ticket. Every automated quality check it was put through passed.'}
        </p>
      </div>
    </div>
  );
}

/** Which spans of the invoice are the real figures the answer got wrong. */
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
  switch (kind) {
    case 'email':
      return 'an address that is nowhere in the invoice';
    case 'money':
      return 'an amount that is nowhere in the invoice';
    case 'date':
      return 'a date that is nowhere in the invoice';
    case 'url':
      return 'a link that is nowhere in the invoice';
    case 'identifier':
      return 'an identifier that is nowhere in the invoice';
    default:
      return 'not found in the invoice';
  }
}
