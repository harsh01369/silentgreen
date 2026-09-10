/**
 * A deliberately small YAML reader.
 *
 * The contract file is configuration a person writes by hand, and YAML is what
 * they expect. Pulling in a full YAML library would break the "no runtime
 * dependencies" promise the rest of the engine keeps, and a full YAML library
 * is a large attack surface for a tool that asks to be trusted.
 *
 * So this reads a restricted subset and refuses everything else with a line
 * number:
 *
 *   - two-space indentation, no tabs
 *   - `key: value` and `key:` followed by an indented block
 *   - `- item` lists and `- key: value` lists of maps
 *   - `#` comments, on their own line or trailing
 *   - single and double quoted scalars, and bare scalars
 *   - `|` and `>` block scalars for multi-line prose (the attests line)
 *   - a single inline flow list of simple scalars: `[money, date, url]`
 *   - `true`, `false`, `null`, integers and decimals are typed; everything else
 *     is a string
 *
 * No inline maps (`{}`), no nested flow, no anchors, no multi-document files.
 * If a contract needs those, it can be written as JSON instead.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

export interface YamlResult {
  readonly value: YamlValue | undefined;
  readonly errors: readonly string[];
}

interface Line {
  readonly n: number;
  readonly indent: number;
  readonly text: string;
}

function scalar(raw: string): YamlValue {
  const s = raw.trim();
  if (s === '' || s === '~' || s === 'null') return null;
  if (s === 'true') return true;
  if (s === 'false') return false;
  // A single inline flow list of simple scalars: [money, date, url].
  if (s.startsWith('[') && s.endsWith(']')) {
    const body = s.slice(1, -1).trim();
    if (body === '') return [];
    if (!body.includes('[') && !body.includes('{')) return body.split(',').map((p) => scalar(p.trim()));
  }
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    const inner = s.slice(1, -1);
    return s[0] === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner.replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  return s;
}

export function parseYaml(text: string): YamlResult {
  const errors: string[] = [];
  const raw = text.replace(/\r\n?/g, '\n').split('\n');

  const lines: Line[] = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i]!;
    if (r.includes('\t')) errors.push(`line ${i + 1}: tabs are not allowed for indentation, use two spaces`);
    const withoutComment = stripTrailingComment(r);
    if (withoutComment.trim() === '') continue;
    const indent = withoutComment.length - withoutComment.trimStart().length;
    if (indent % 2 !== 0) errors.push(`line ${i + 1}: indentation must be a multiple of two spaces`);
    lines.push({ n: i + 1, indent, text: withoutComment.trim() });
  }

  if (errors.length > 0) return { value: undefined, errors };
  if (lines.length === 0) return { value: undefined, errors: ['the file is empty'] };

  let cursor = 0;

  function parseBlock(minIndent: number): YamlValue {
    const first = lines[cursor]!;
    const isList = first.text.startsWith('- ') || first.text === '-';
    return isList ? parseList(first.indent) : parseMap(first.indent);

    function parseList(indent: number): YamlValue[] {
      const out: YamlValue[] = [];
      while (cursor < lines.length) {
        const line = lines[cursor]!;
        if (line.indent < indent || (!line.text.startsWith('- ') && line.text !== '-')) break;
        if (line.indent > indent) {
          errors.push(`line ${line.n}: unexpected indentation in a list`);
          cursor++;
          continue;
        }
        const rest = line.text === '-' ? '' : line.text.slice(2).trim();
        if (rest === '') {
          cursor++;
          if (cursor < lines.length && lines[cursor]!.indent > indent) out.push(parseBlock(indent + 2));
          else out.push(null);
        } else if (/^[^:\s][^:]*:(\s|$)/.test(rest)) {
          // "- key: value" — a one-line map that may continue on indented lines.
          const synthIndent = line.indent + 2;
          lines[cursor] = { n: line.n, indent: synthIndent, text: rest };
          out.push(parseMap(synthIndent));
        } else {
          out.push(scalar(rest));
          cursor++;
        }
      }
      return out;
    }

    function parseMap(indent: number): { [k: string]: YamlValue } {
      const out: { [k: string]: YamlValue } = {};
      while (cursor < lines.length) {
        const line = lines[cursor]!;
        if (line.indent < indent) break;
        if (line.indent > indent) {
          errors.push(`line ${line.n}: unexpected indentation`);
          cursor++;
          continue;
        }
        const m = line.text.match(/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]+?)\s*:\s*(.*)$/);
        if (!m) {
          errors.push(`line ${line.n}: expected "key: value"`);
          cursor++;
          continue;
        }
        const key = String(scalar(m[1]!));
        const inline = m[2]!.trim();
        cursor++;

        if (inline === '|' || inline === '>' || inline === '|-' || inline === '>-') {
          out[key] = readBlockScalar(indent, inline.startsWith('>'));
        } else if (inline === '') {
          if (cursor < lines.length && lines[cursor]!.indent > indent) out[key] = parseBlock(indent + 2);
          else out[key] = null;
        } else {
          out[key] = scalar(inline);
        }
      }
      return out;
    }

    function readBlockScalar(parentIndent: number, folded: boolean): string {
      const collected: string[] = [];
      let blockIndent = -1;
      while (cursor < lines.length) {
        const line = lines[cursor]!;
        if (line.indent <= parentIndent) break;
        if (blockIndent === -1) blockIndent = line.indent;
        collected.push(' '.repeat(Math.max(0, line.indent - blockIndent)) + line.text);
        cursor++;
      }
      return folded ? collected.join(' ') : collected.join('\n');
    }
  }

  const value = parseBlock(0);
  if (cursor < lines.length) errors.push(`line ${lines[cursor]!.n}: could not be read as part of the document`);
  return { value, errors };
}

/** Remove a `#` comment that is not inside quotes. */
function stripTrailingComment(line: string): string {
  let inS = false;
  let inD = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (ch === '#' && !inS && !inD && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      return line.slice(0, i);
    }
  }
  return line;
}
