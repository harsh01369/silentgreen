/**
 * Two facts that are each in the source, joined in a way the source does not.
 *
 * Atom-level groundedness passes an answer where every figure and every date
 * occurs somewhere in the material. It cannot see that the £571 belongs to one
 * invoice and the due date to another, because both strings are present. That
 * is the RAG failure that atom checking misses: the right pieces, wired up
 * wrong.
 *
 * This looks for it, and only in the one case where it can be sure enough to
 * speak: the source splits cleanly into more than one record, the answer pairs
 * an amount with a due date, the amount sits in exactly one record, the date
 * sits in a different one, and the amount's own record carries a different
 * date. When all of that holds, the verdict is `unproven`, not `violated`,
 * with a sentence naming both records, because the honest statement is "the
 * source pairs these differently, check which record this answer is about".
 *
 * No model. Everything here is string position in the source.
 */

export interface Misassociation {
  /** One sentence, for someone deciding whether to look. */
  readonly summary: string;
  /** The literal figures and the record boundaries that decided it. */
  readonly evidence: string;
}

interface Record_ {
  readonly label: string;
  readonly text: string;
}

/** Split source text into records, when it clearly is more than one. */
function splitRecords(source: string): Record_[] {
  // Preferred: a repeated identifier that looks like a record header.
  const headerRe = /\b((?:invoice|inv|order|ord|account|acct|ref|reference|po)[\s#:-]*[A-Z0-9][A-Z0-9-]{2,})/gi;
  const headers = [...source.matchAll(headerRe)];
  if (headers.length >= 2) {
    const out: Record_[] = [];
    for (let i = 0; i < headers.length; i++) {
      const start = headers[i]!.index ?? 0;
      const end = i + 1 < headers.length ? (headers[i + 1]!.index ?? source.length) : source.length;
      out.push({ label: headers[i]![1]!.replace(/\s+/g, ' ').trim(), text: source.slice(start, end) });
    }
    return out;
  }

  // Fallback: blank-line-separated blocks, each with at least one amount.
  const blocks = source
    .split(/\n\s*\n/)
    .map((b, i) => ({ label: `block ${i + 1}`, text: b }))
    .filter((b) => /[£$€¥]\s?\d|\d[\d,]*\.\d{2}|\b(?:USD|GBP|EUR)\s?\d/.test(b.text));
  return blocks.length >= 2 ? blocks : [];
}

const MONEY_G = /[£$€¥]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*\.\d{2}|\b(?:USD|GBP|EUR|INR)\s?\d[\d,]*(?:\.\d+)?/g;
const DATE_G = /\b\d{4}-\d{2}-\d{2}\b/g;

function num(s: string): number {
  return Number(s.replace(/[^0-9.]/g, ''));
}

function recordsContaining(records: Record_[], test: (t: string) => boolean): Record_[] {
  return records.filter((r) => test(r.text));
}

export function checkAssociation(output: string, sources: readonly string[]): readonly Misassociation[] {
  const source = sources.join('\n\n');
  const records = splitRecords(source);
  if (records.length < 2) return [];

  const out: Misassociation[] = [];

  // The answer pairs an amount with a due date: "<amount> ... due ... <date>"
  // or "due <date> ... <amount>", within a short window.
  const pairRe =
    /([£$€¥]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*\.\d{2}|(?:USD|GBP|EUR|INR)\s?\d[\d,]*(?:\.\d+)?)[^.\n]{0,60}?\bdue\b[^.\n]{0,20}?(\d{4}-\d{2}-\d{2})|\bdue\b[^.\n]{0,20}?(\d{4}-\d{2}-\d{2})[^.\n]{0,60}?([£$€¥]\s?\d[\d,]*(?:\.\d{2})?|\d[\d,]*\.\d{2})/gi;

  for (const m of output.matchAll(pairRe)) {
    const amountRaw = (m[1] ?? m[4] ?? '').trim();
    const dateRaw = (m[2] ?? m[3] ?? '').trim();
    if (!amountRaw || !dateRaw) continue;

    const amountVal = num(amountRaw);
    const amountRecords = recordsContaining(records, (t) => {
      for (const a of t.matchAll(MONEY_G)) if (Math.abs(num(a[0]) - amountVal) < 0.005) return true;
      return false;
    });
    const dateRecords = recordsContaining(records, (t) => t.includes(dateRaw));

    if (amountRecords.length !== 1 || dateRecords.length !== 1) continue;
    const amountRec = amountRecords[0]!;
    const dateRec = dateRecords[0]!;
    if (amountRec.label === dateRec.label) continue; // consistent, nothing to say

    // Only speak if the amount's own record has a different due date, so this is
    // a real crossing and not just a source that mentions the date elsewhere.
    const datesInAmountRec = [...amountRec.text.matchAll(DATE_G)].map((d) => d[0]);
    if (datesInAmountRec.length === 0 || datesInAmountRec.includes(dateRaw)) continue;

    out.push({
      summary: `The answer pairs ${amountRaw} with a due date of ${dateRaw}, but the source pairs them differently: ${amountRaw} belongs to ${amountRec.label} (due ${datesInAmountRec[0]}), and ${dateRaw} belongs to ${dateRec.label}. Both facts are in the source; the answer may be about the wrong record.`,
      evidence: `${amountRaw} in "${amountRec.label}"; ${dateRaw} in "${dateRec.label}"`,
    });
  }

  // De-duplicate identical summaries.
  const seen = new Set<string>();
  return out.filter((o) => (seen.has(o.summary) ? false : (seen.add(o.summary), true)));
}
