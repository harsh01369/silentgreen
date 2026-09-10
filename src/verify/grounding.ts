/**
 * Did the answer come from the source, or from the model?
 *
 * This is the check the rest of this market cannot make honestly, because the
 * standard method is to ask another language model whether the answer looks
 * right. That is marking homework with the same pen. The published numbers on
 * it are not encouraging: judges score their own family's output higher, flip
 * preference on about a quarter of hard cases under repeated scoring, and drop
 * from roughly 80% agreement in a controlled test to worse than a coin flip on
 * bias probes in production.
 *
 * So this asks a smaller question that has an actual answer. Not "is this good"
 * but "does every checkable atom in the output appear in the material the model
 * was given". Numbers, dates, money, emails, URLs, identifiers, quoted spans and
 * capitalised names are all things that either occur in the source or do not.
 * No model is consulted. The verdict is decided by the source text, which is why
 * it can be trusted about a model.
 *
 * It is deliberately narrow. It cannot tell you an answer is wise, complete or
 * well-judged. It can tell you the invoice total the agent quoted appears
 * nowhere in the invoice, which is the failure that actually costs money.
 *
 * The bias runs hard towards silence. A false accusation that an AI fabricated
 * something is worse than a miss, because the miss leaves you where you already
 * were and the accusation makes this tool the problem.
 */

/** What kind of thing we found, so a report can say why it matters. */
export type AtomKind = 'number' | 'money' | 'date' | 'email' | 'url' | 'identifier' | 'quote' | 'name';

export interface Atom {
  readonly kind: AtomKind;
  readonly text: string;
  /** Normalised for comparison. Two atoms match when these are equal. */
  readonly key: string;
}

export interface UngroundedAtom extends Atom {
  /** Written for somebody deciding whether this is a real fabrication. */
  readonly why: string;
}

export interface GroundingResult {
  readonly checked: number;
  readonly ungrounded: readonly UngroundedAtom[];
  /** True when there was too little to check for the answer to mean anything. */
  readonly inconclusive: boolean;
  readonly reason?: string;
}

/**
 * Words that look like names because they are capitalised, and are not.
 * Sentence starts, months, days and common openers produce most false positives,
 * so they are excluded before anything is claimed.
 */
const NOT_NAMES = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'this', 'that', 'these', 'those',
  'i', 'we', 'you', 'he', 'she', 'it', 'they', 'there', 'here', 'his', 'her', 'their',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september',
  'october', 'november', 'december',
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'yes', 'no', 'please', 'thanks', 'thank', 'hello', 'hi', 'dear', 'regards', 'sincerely',
  'note', 'summary', 'total', 'subtotal', 'overview', 'introduction', 'conclusion',
  'based', 'according', 'however', 'therefore', 'additionally', 'furthermore', 'finally',
  'unfortunately', 'sorry', 'as', 'in', 'on', 'at', 'for', 'to', 'from', 'with', 'by',
  'your', 'our', 'my', 'all', 'each', 'every', 'some', 'any', 'no', 'not',
]);

/** Numbers this small are ordinals and counts, not facts worth policing. */
const TRIVIAL_NUMBER_MAX = 10;

function normaliseNumber(s: string): string {
  // 1,234.50 and 1234.5 and 1234.50 are the same number.
  const cleaned = s.replace(/[,\s]/g, '');
  const n = Number(cleaned.replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return cleaned.toLowerCase();
  return String(n);
}

function normaliseText(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

const PATTERNS: ReadonlyArray<{ kind: AtomKind; re: RegExp }> = [
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { kind: 'url', re: /\bhttps?:\/\/[^\s"'<>)\]]+/g },
  {
    kind: 'money',
    re: /(?:[$£€¥₹]\s?\d[\d,]*(?:\.\d+)?)|(?:\d[\d,]*(?:\.\d+)?\s?(?:USD|GBP|EUR|INR|JPY|AUD|CAD|CHF))\b|(?:\b(?:USD|GBP|EUR|INR|JPY|AUD|CAD|CHF)\s?\d[\d,]*(?:\.\d+)?)/g,
  },
  { kind: 'date', re: /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g },
  // Identifiers: ORD-1042, INV-2026-0412, SKU12345. Every dashed segment has to
  // be consumed in one match, or the tail is left behind and reported as a
  // stray number, which points a reviewer at "9999" instead of at the invented
  // invoice number it came from.
  { kind: 'identifier', re: /\b[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+\b|\b[A-Z]{2,}\d{3,}\b/g },
  { kind: 'number', re: /\b\d[\d,]*(?:\.\d+)?\b/g },
];

const QUOTE_RE = /["“”]([^"“”\n]{12,200})["“”]/g;

/**
 * The forms a date could be written in, as ISO strings.
 *
 * "03/11/2026" is the same day as "2026-11-03", and an answer that reformats a
 * date has not invented it. Where the day and month are both 12 or less the
 * order is genuinely ambiguous, so both readings are returned and a match on
 * either counts. This slightly weakens detection of a fabricated date that
 * happens to equal the swapped reading of a real one, which is the right trade:
 * a missed catch leaves the reviewer where they were, a false accusation does not.
 */
function dateCandidates(raw: string): readonly string[] {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return [`${iso[1]}-${iso[2]}-${iso[3]}`];

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    const pad = (n: number) => String(n).padStart(2, '0');
    const out: string[] = [];
    // day/month/year
    if (a >= 1 && a <= 31 && b >= 1 && b <= 12) out.push(`${y}-${pad(b)}-${pad(a)}`);
    // month/day/year
    if (b >= 1 && b <= 31 && a >= 1 && a <= 12) out.push(`${y}-${pad(a)}-${pad(b)}`);
    return out.length > 0 ? out : [raw.toLowerCase()];
  }
  return [raw.toLowerCase()];
}

/**
 * Numbers written as words: "two thousand", "twenty-five thousand pounds".
 *
 * Only spans that carry a scale word (hundred, thousand, million, billion) are
 * matched, so an ordinary "one of the reasons" is left alone. Returns the span
 * as written and its value, so "£2,000" in the answer and "two thousand" in the
 * source resolve to the same key.
 */
const NUM_WORD: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUM_SCALE: Record<string, number> = { hundred: 100, thousand: 1000, million: 1_000_000, billion: 1_000_000_000 };

const SPELLED_RE = new RegExp(
  String.raw`\b(?:(?:${Object.keys(NUM_WORD).join('|')}|${Object.keys(NUM_SCALE).join('|')}|and|a)[\s-]+)*(?:${Object.keys(
    NUM_SCALE,
  ).join('|')})\b`,
  'gi',
);

function spelledValue(span: string): number | null {
  const words = span.toLowerCase().split(/[\s-]+/).filter((w) => w && w !== 'and');
  let result = 0;
  let current = 0;
  let sawAny = false;
  for (const w of words) {
    if (w === 'a') {
      current = current || 1;
      continue;
    }
    if (w in NUM_WORD) {
      current += NUM_WORD[w]!;
      sawAny = true;
    } else if (w in NUM_SCALE) {
      const scale = NUM_SCALE[w]!;
      sawAny = true;
      if (scale >= 1000) {
        result += (current || 1) * scale;
        current = 0;
      } else {
        current = (current || 1) * scale;
      }
    } else {
      return null;
    }
  }
  return sawAny ? result + current : null;
}

export function spelledNumbers(text: string): { raw: string; value: number }[] {
  const out: { raw: string; value: number }[] = [];
  for (const m of text.matchAll(SPELLED_RE)) {
    const raw = m[0].trim();
    const value = spelledValue(raw);
    if (value !== null && value > TRIVIAL_NUMBER_MAX) out.push({ raw, value });
  }
  return out;
}

/**
 * Pull out the things in this text that are either true of the source or not.
 *
 * Order matters: an email is matched before the number inside it, so an address
 * does not also produce three spurious number atoms.
 */
export function extractAtoms(text: string): readonly Atom[] {
  if (!text) return [];
  let remaining = text;
  const atoms: Atom[] = [];
  const seen = new Set<string>();

  /**
   * Sentence punctuation that a greedy pattern will happily swallow.
   *
   * "...at https://example.com/inv/1." captures the full stop, which then fails
   * to match the source and reports a correct answer as an invented link. That
   * single bug flagged fourteen faithful answers in the worked example, and a
   * tool that does that in front of a user is finished.
   */
  const trimTrailingPunctuation = (s: string): string => s.replace(/[.,;:!?)\]}'"»]+$/, '');

  const push = (kind: AtomKind, rawIn: string, keyIn: string) => {
    let raw = rawIn;
    let key = keyIn;
    if (kind === 'url' || kind === 'email' || kind === 'identifier') {
      raw = trimTrailingPunctuation(raw);
      key = trimTrailingPunctuation(key);
    }
    if (!raw) return;
    const id = `${kind}|${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    atoms.push({ kind, text: raw, key });
  };

  // Quotations come out of the original text, before anything is stripped. A
  // number or a name inside a quotation must not be carved out from under it,
  // or the quote is checked against the source with holes where its facts were.
  for (const m of text.matchAll(QUOTE_RE)) {
    const raw = m[1] ?? '';
    if (raw) push('quote', raw, normaliseText(raw));
  }

  // Numbers written as words, keyed by their value so they match digit forms.
  for (const { raw, value } of spelledNumbers(text)) {
    push('number', raw, String(value));
    remaining = remaining.split(raw).join(' ');
  }

  for (const { kind, re } of PATTERNS) {
    const found: string[] = [];
    for (const m of remaining.matchAll(new RegExp(re.source, re.flags))) {
      const raw = m[0];
      if (!raw) continue;
      found.push(m[0]);

      if (kind === 'number' || kind === 'money') {
        const n = Number(normaliseNumber(raw));
        // Small integers are counts and list positions, not claims.
        if (kind === 'number' && Number.isFinite(n) && Math.abs(n) <= TRIVIAL_NUMBER_MAX && !raw.includes('.')) continue;
        push(kind, raw, normaliseNumber(raw));
      } else {
        push(kind, raw, normaliseText(raw));
      }
    }
    // Remove what we matched so later, broader patterns do not re-match inside it.
    for (const f of found) remaining = remaining.split(f).join(' ');
  }

  // Capitalised runs, which is where invented people, companies and products live.
  for (const m of remaining.matchAll(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,3})\b/g)) {
    const raw = m[1] ?? '';
    const words = raw.split(/\s+/);

    if (words.length === 1) {
      const w = words[0]!.toLowerCase();
      if (NOT_NAMES.has(w) || w.length < 4) continue;
      // A single capitalised word that opens a sentence is grammar, not a name.
      // Without this, "Payment is due..." reports an invented entity called
      // Payment, and one such accusation costs more trust than ten real catches
      // earn. A name that matters will almost always also occur mid-sentence.
      const before = remaining.slice(Math.max(0, (m.index ?? 0) - 40), m.index ?? 0);
      if (/(^|[.!?:;•\-])\s*$/.test(before) || /\n\s*$/.test(before)) continue;
    } else if (words.every((w) => NOT_NAMES.has(w.toLowerCase()))) {
      continue;
    }
    push('name', raw, normaliseText(raw));
  }

  return atoms;
}

/**
 * Company-form suffixes that are interchangeable or droppable. "Fernweh Supply
 * Ltd", "Fernweh Supply Limited" and "Fernweh Supply" are the same entity, and
 * an answer that renders the suffix differently has not invented a company.
 */
const ORG_SUFFIX_SRC =
  String.raw`\b(?:ltd|limited|inc|incorporated|llc|l\.l\.c|llp|plc|gmbh|ag|s\.a|sa|s\.r\.l|srl|b\.v|bv|pvt|private|pte|co|corp|corporation|company|holdings?|group|partners?)\b\.?`;

function hasOrgSuffix(s: string): boolean {
  return new RegExp(ORG_SUFFIX_SRC, 'i').test(s);
}

function stripOrgSuffix(s: string): string {
  return s
    .replace(new RegExp(ORG_SUFFIX_SRC, 'gi'), '')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A name counts as present if it appears verbatim, or if it appears once its
 * interchangeable company suffix is set aside on both sides. The stripped form
 * has to keep at least two words or six characters, so "Inc" alone can never
 * match "increase".
 */
function nameIsPresent(atom: Atom, sourceRaw: string, sourceNormalised: string): boolean {
  if (sourceNormalised.includes(atom.key) || sourceRaw.includes(atom.text)) return true;
  if (!hasOrgSuffix(atom.text)) return false;
  const stripped = stripOrgSuffix(atom.key);
  if (stripped.length < 6 && stripped.split(' ').length < 2) return false;
  return stripOrgSuffix(sourceNormalised).includes(stripped);
}

/**
 * The nearest figure in the source to an amount that was not found, when there
 * is one close enough to look like a slip rather than an invention: within two
 * percent, or a single digit transposition. Used only to make the evidence more
 * useful; it never changes the verdict.
 */
function nearestSourceNumber(value: number, sourceNumbers: ReadonlySet<string>): number | null {
  let best: number | null = null;
  let bestGap = Infinity;
  const digits = String(Math.round(Math.abs(value)));
  for (const key of sourceNumbers) {
    const n = Number(key);
    if (!Number.isFinite(n) || n === value || n === 0) continue;
    const gap = Math.abs(n - value);
    const rel = gap / Math.max(Math.abs(value), 1);
    // A transposition keeps the digits and the magnitude: 539 and 593, not 124
    // and 412. Require the same digit multiset and a ratio inside [0.5, 2].
    const ratio = Math.abs(n) / Math.max(Math.abs(value), 1e-9);
    const sameDigitsReordered =
      String(Math.round(Math.abs(n))).length === digits.length &&
      String(Math.round(Math.abs(n))).split('').sort().join('') === digits.split('').sort().join('') &&
      ratio >= 0.5 &&
      ratio <= 2;
    if ((rel <= 0.02 || sameDigitsReordered) && gap < bestGap) {
      best = n;
      bestGap = gap;
    }
  }
  return best;
}

/**
 * Is this atom present in the source?
 *
 * Comparison is deliberately forgiving: normalised case and whitespace,
 * number formatting ignored, and a quoted span counts as grounded if the source
 * contains it with different punctuation or line breaks.
 */
function isPresent(
  atom: Atom,
  sourceRaw: string,
  sourceNormalised: string,
  sourceNumbers: ReadonlySet<string>,
  sourceDates: ReadonlySet<string>,
): boolean {
  switch (atom.kind) {
    case 'number':
    case 'money':
      return sourceNumbers.has(atom.key);
    case 'date': {
      if (sourceNormalised.includes(atom.key)) return true;
      return dateCandidates(atom.text).some((d) => sourceDates.has(d));
    }
    case 'quote': {
      // Punctuation inside a quotation is the model's business; the words are ours.
      const words = atom.key.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
      const src = sourceNormalised.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ');
      return src.includes(words);
    }
    case 'name':
      return nameIsPresent(atom, sourceRaw, sourceNormalised);
    default:
      return sourceNormalised.includes(atom.key) || sourceRaw.includes(atom.text);
  }
}

function describe(atom: Atom): string {
  switch (atom.kind) {
    case 'money':
      return 'a monetary amount that appears nowhere in the material the model was given';
    case 'number':
      return 'a figure that does not appear in the source';
    case 'date':
      return 'a date that does not appear in the source';
    case 'email':
      return 'an email address that does not appear in the source, which means it was either invented or carried in from somewhere else';
    case 'url':
      return 'a link that does not appear in the source, and invented links are among the most confidently produced things a model does';
    case 'identifier':
      return 'an identifier that does not appear in the source, so anything downstream keyed on it will not resolve';
    case 'quote':
      return 'a passage presented as a quotation that is not in the source';
    case 'name':
      return 'a proper name that does not appear in the source';
  }
}

export interface GroundingOptions {
  /** Kinds to check. Narrowing this is the main way to quieten a noisy corpus. */
  readonly kinds?: readonly AtomKind[];
  /** Below this many checkable atoms, we decline to conclude anything. */
  readonly minAtoms?: number;
}

/**
 * Check an answer against the material it was given.
 *
 * `sources` is everything the model could legitimately have drawn on: retrieved
 * documents, the prompt, tool results, the record it was asked to summarise.
 */
export function checkGrounding(
  output: string,
  sources: readonly string[],
  opts: GroundingOptions = {},
): GroundingResult {
  const kinds = new Set<AtomKind>(opts.kinds ?? ['money', 'identifier', 'email', 'url', 'date', 'quote', 'number', 'name']);
  const minAtoms = opts.minAtoms ?? 1;

  const sourceRaw = sources.join('\n');
  if (sourceRaw.trim().length === 0) {
    return {
      checked: 0,
      ungrounded: [],
      inconclusive: true,
      reason:
        'No source material was captured for this task, so there is nothing to check the answer against. That is a gap in the evidence rather than a clean result.',
    };
  }

  const sourceNormalised = normaliseText(sourceRaw);
  const sourceNumbers = new Set<string>();
  for (const m of sourceRaw.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)) sourceNumbers.add(normaliseNumber(m[0]));
  for (const { value } of spelledNumbers(sourceRaw)) sourceNumbers.add(String(value));

  const sourceDates = new Set<string>();
  for (const m of sourceRaw.matchAll(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/g)) {
    for (const d of dateCandidates(m[0])) sourceDates.add(d);
  }

  const atoms = extractAtoms(output).filter((a) => kinds.has(a.kind));
  if (atoms.length < minAtoms) {
    return {
      checked: atoms.length,
      ungrounded: [],
      inconclusive: true,
      reason: `The answer contains ${atoms.length} checkable fact(s), which is too few to conclude anything. Groundedness is a claim about specifics, and prose without specifics cannot be checked this way.`,
    };
  }

  const ungrounded: UngroundedAtom[] = [];
  for (const atom of atoms) {
    if (isPresent(atom, sourceRaw, sourceNormalised, sourceNumbers, sourceDates)) continue;
    let why = describe(atom);
    if (atom.kind === 'money' || atom.kind === 'number') {
      const near = nearestSourceNumber(Number(atom.key), sourceNumbers);
      if (near !== null) {
        why += `. The closest figure in the source is ${near}, so this looks like a slip rather than an invention, but it is still not what the source says`;
      }
    }
    ungrounded.push({ ...atom, why });
  }

  return { checked: atoms.length, ungrounded, inconclusive: false };
}
