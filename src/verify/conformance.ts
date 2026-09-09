/**
 * If the answer was supposed to be structured, is it?
 *
 * A pipeline that asks a model for JSON and feeds the result straight into the
 * next step fails hard when the model returns JSON wrapped in an apology, or a
 * markdown fence, or a response that was cut off mid-object. None of that needs
 * a source or a model to detect: the text either parses as what it claims to be
 * or it does not.
 *
 * As everywhere here, it only speaks when the answer is clearly meant to be
 * structured. Prose that happens to contain a brace is left alone.
 */

export type MalformedKind = 'unparseable-json' | 'json-with-surrounding-prose' | 'truncated' | 'ragged-table';

export interface Malformed {
  readonly kind: MalformedKind;
  readonly summary: string;
  readonly evidence: string;
}

const JSON_ASKED = /\b(?:return|reply|respond|output|format|give|provide)\b[^.]*\bjson\b|\bas json\b|\bin json\b|\bvalid json\b/i;

function stripFence(s: string): { body: string; hadFence: boolean } {
  const m = s.match(/^\s*```(?:json|json5)?\s*\n?([\s\S]*?)\n?```\s*$/i);
  if (m && m[1] !== undefined) return { body: m[1].trim(), hadFence: true };
  return { body: s, hadFence: false };
}

/** Where, if anywhere, the outermost JSON value starts and ends in the text. */
function locateJson(s: string): { start: number; end: number } | undefined {
  const first = s.search(/[[{]/);
  if (first === -1) return undefined;
  const open = s[first];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = first; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return { start: first, end: i + 1 };
    }
  }
  return { start: first, end: -1 }; // opened, never closed
}

export function checkConformance(output: string, input = ''): readonly Malformed[] {
  const text = output.trim();
  if (text.length === 0) return [];

  const looksJson = /^[[{]/.test(text) || /```json/i.test(output) || JSON_ASKED.test(input);
  const out: Malformed[] = [];

  if (looksJson) {
    const { body, hadFence } = stripFence(text);
    const located = locateJson(body);

    if (!located) {
      // Asked for JSON, produced none.
      out.push({
        kind: 'unparseable-json',
        summary: 'The answer was expected to be JSON but contains no JSON value.',
        evidence: text.slice(0, 160),
      });
    } else if (located.end === -1) {
      out.push({
        kind: 'truncated',
        summary: 'The JSON opens but never closes, so the answer was cut off before it finished.',
        evidence: `...${body.slice(Math.max(0, body.length - 120))}`,
      });
    } else {
      const candidate = body.slice(located.start, located.end);
      try {
        JSON.parse(candidate);
        const before = body.slice(0, located.start).trim();
        const after = body.slice(located.end).trim();
        if ((before.length > 0 || after.length > 0) && !hadFence) {
          out.push({
            kind: 'json-with-surrounding-prose',
            summary: 'The JSON is valid but has prose around it, so a parser expecting only JSON will reject the whole response.',
            evidence: (before || after).slice(0, 160),
          });
        }
      } catch (err) {
        out.push({
          kind: 'unparseable-json',
          summary: `The answer looks like JSON but does not parse: ${String((err as Error).message).slice(0, 100)}.`,
          evidence: candidate.slice(0, 160),
        });
      }
    }
  }

  // A markdown table where the rows disagree on column count.
  const tableLines = text.split('\n').filter((l) => /^\s*\|.*\|\s*$/.test(l));
  if (tableLines.length >= 3) {
    const cols = tableLines
      .filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l))
      .map((l) => l.split('|').slice(1, -1).length);
    const first = cols[0];
    if (first !== undefined && cols.some((n) => n !== first)) {
      out.push({
        kind: 'ragged-table',
        summary: `The table rows do not have the same number of columns (${[...new Set(cols)].join(', ')}).`,
        evidence: tableLines.slice(0, 3).join('  //  ').slice(0, 200),
      });
    }
  }

  return out;
}
