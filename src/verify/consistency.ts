/**
 * Does the answer contradict itself?
 *
 * This needs no source material and no model. An answer that states a subtotal,
 * a tax amount and a total where the three do not add up has a defect on its
 * face, whatever the invoice says. So does one that quotes two different figures
 * for the same thing, or a due date that falls before the issue date.
 *
 * The bias is the same as everywhere else in this codebase: only speak when the
 * arithmetic is unambiguous. A total that could be reconciled by a shipping
 * line or a discount the answer also mentions is left alone.
 */

export type InconsistencyKind = 'arithmetic' | 'restated-value' | 'date-order' | 'percentage';

export interface Inconsistency {
  readonly kind: InconsistencyKind;
  /** One sentence, for someone deciding whether to act. */
  readonly summary: string;
  /** The literal figures or dates that decided it. */
  readonly evidence: string;
}

// A currency amount: a symbol with digits, or digits with exactly two decimal
// places. A bare integer is not money here, which keeps "net 15" and "at 20%"
// from being read as figures.
const MONEY = String.raw`(?:[$£€¥]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*\.\d{2})(?!\s?%|\d)`;

function amount(s: string): number {
  return Number(s.replace(/[^0-9.]/g, ''));
}

/** Money that is close enough, given how these are usually rounded. */
function near(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.02 + Math.max(Math.abs(a), Math.abs(b)) * 1e-6;
}

const SUBTOTAL_LABELS = ['subtotal', 'sub-total', 'sub total', 'net amount', 'net total', 'goods total'];
const TAX_LABELS = ['vat', 'tax', 'gst', 'sales tax'];
const TOTAL_LABELS = ['grand total', 'total due', 'total amount due', 'amount due', 'total payable', 'amount payable', 'balance due', 'total', 'balance', 'outstanding balance'];
const ADJUSTMENT_LABELS = ['shipping', 'delivery', 'postage', 'discount', 'credit', 'handling', 'fee', 'surcharge', 'adjustment'];

function labelPattern(label: string): string {
  // Between the label and its amount: ordinary words, or a percentage token
  // ("at 20%"), but not another figure. Kept short so the label cannot reach
  // across a sentence and pick up an unrelated number.
  const gap = String.raw`(?:[^\d$£€¥\n]|\d{1,3}(?:\.\d+)?\s?%){0,20}?`;
  return `\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b${gap}(${MONEY})`;
}

/** Pull the first amount that follows any of these labels within a short span. */
function labelled(text: string, labels: readonly string[]): { value: number; raw: string } | undefined {
  for (const label of labels) {
    const m = new RegExp(labelPattern(label), 'i').exec(text);
    if (m && m[1]) return { value: amount(m[1]), raw: `${label} ${m[1].trim()}` };
  }
  return undefined;
}

function allLabelled(text: string, labels: readonly string[]): { value: number; raw: string }[] {
  const out: { value: number; raw: string }[] = [];
  for (const label of labels) {
    for (const m of text.matchAll(new RegExp(labelPattern(label), 'gi'))) {
      if (m[1]) out.push({ value: amount(m[1]), raw: `${label} ${m[1].trim()}` });
    }
  }
  return out;
}

function checkArithmetic(text: string, out: Inconsistency[]): void {
  const sub = labelled(text, SUBTOTAL_LABELS);
  const tax = labelled(text, TAX_LABELS);
  const total = labelled(text, TOTAL_LABELS);
  if (!sub || !total) return;

  // If the answer itself mentions a shipping line, a discount or a fee, the
  // simple sum is not expected to hold and we say nothing.
  const hasAdjustment = ADJUSTMENT_LABELS.some((l) => new RegExp(`\\b${l}\\b`, 'i').test(text));
  if (hasAdjustment) return;

  const expected = sub.value + (tax?.value ?? 0);
  if (!near(expected, total.value)) {
    out.push({
      kind: 'arithmetic',
      summary: tax
        ? `The subtotal and tax do not add up to the stated total: ${sub.value.toFixed(2)} + ${tax.value.toFixed(2)} is ${expected.toFixed(2)}, not ${total.value.toFixed(2)}.`
        : `The subtotal does not match the stated total, and no tax or adjustment is given to bridge them: ${sub.value.toFixed(2)} against ${total.value.toFixed(2)}.`,
      evidence: [sub.raw, tax?.raw, total.raw].filter(Boolean).join('; '),
    });
  }
}

function checkRestatedValue(text: string, out: Inconsistency[]): void {
  for (const [name, labels] of [
    ['total', TOTAL_LABELS],
    ['subtotal', SUBTOTAL_LABELS],
    ['tax', TAX_LABELS],
  ] as const) {
    const seen = allLabelled(text, labels);
    if (seen.length < 2) continue;
    const distinct = [...new Set(seen.map((s) => s.value.toFixed(2)))];
    if (distinct.length > 1) {
      out.push({
        kind: 'restated-value',
        summary: `The answer gives more than one figure for the ${name}: ${distinct.join(' and ')}.`,
        evidence: seen.map((s) => s.raw).join('; '),
      });
      return;
    }
  }
}

function checkPercentage(text: string, out: Inconsistency[]): void {
  // "VAT at 20% ... £114.20" against a subtotal of £571.00
  const sub = labelled(text, SUBTOTAL_LABELS);
  const pct = /\b(\d{1,2}(?:\.\d+)?)\s?%/.exec(text);
  const tax = labelled(text, TAX_LABELS);
  if (!sub || !pct || !tax || !pct[1]) return;
  const rate = Number(pct[1]) / 100;
  const expected = sub.value * rate;
  // Only flag a clear miss, not a rounding disagreement.
  if (Math.abs(expected - tax.value) > 0.5 + sub.value * 0.001) {
    out.push({
      kind: 'percentage',
      summary: `Tax is stated as ${pct[1]}% but the amount does not match: ${pct[1]}% of ${sub.value.toFixed(2)} is ${expected.toFixed(2)}, not ${tax.value.toFixed(2)}.`,
      evidence: `${sub.raw}; rate ${pct[1]}%; ${tax.raw}`,
    });
  }
}

const ISSUE_LABELS = ['issued', 'issue date', 'invoice date', 'order date', 'dated', 'created'];
const DUE_LABELS = ['due', 'due date', 'payment due', 'pay by', 'payable by'];

function isoDate(text: string, labels: readonly string[]): { iso: string; raw: string } | undefined {
  for (const label of labels) {
    const re = new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^\\d\\n]{0,16}?(\\d{4}-\\d{2}-\\d{2})`, 'i');
    const m = re.exec(text);
    if (m && m[1]) return { iso: m[1], raw: `${label} ${m[1]}` };
  }
  return undefined;
}

function checkDateOrder(text: string, out: Inconsistency[]): void {
  const issued = isoDate(text, ISSUE_LABELS);
  const due = isoDate(text, DUE_LABELS);
  if (issued && due && due.iso < issued.iso) {
    out.push({
      kind: 'date-order',
      summary: `The due date is before the issue date: due ${due.iso}, issued ${issued.iso}.`,
      evidence: `${issued.raw}; ${due.raw}`,
    });
  }
}

export function checkConsistency(output: string): readonly Inconsistency[] {
  if (!output || output.trim().length === 0) return [];
  const text = output.replace(/ /g, ' ');
  const out: Inconsistency[] = [];
  checkArithmetic(text, out);
  checkRestatedValue(text, out);
  checkPercentage(text, out);
  checkDateOrder(text, out);
  return out;
}
