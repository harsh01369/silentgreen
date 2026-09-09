/**
 * A small glob, for the shapes a CI step actually passes: `traces/*.jsonl`,
 * `out/**\/*.json`. Deliberately not a full implementation, just enough to
 * avoid depending on an experimental Node API. Supports `*`, `?` and `**`.
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';

function segmentRegExp(seg: string): RegExp {
  const body = seg
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}

function readDir(path: string): { name: string; isDir: boolean }[] {
  try {
    return readdirSync(path, { withFileTypes: true }).map((e) => ({ name: e.name, isDir: e.isDirectory() }));
  } catch {
    return [];
  }
}

export function expandGlob(pattern: string): string[] {
  if (!/[*?]/.test(pattern)) return [pattern];

  const parts = pattern.split(/[\\/]/);
  const head = parts[0] ?? '';
  // Drive letter ("C:"), POSIX root (""), or a relative first segment.
  let start: string;
  if (head === '') start = '/';
  else if (/^[A-Za-z]:$/.test(head)) start = head + '\\';
  else start = head || '.';

  let dirs = [start];

  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i]!;
    const isLast = i === parts.length - 1;
    const next: string[] = [];

    for (const d of dirs) {
      if (seg === '**') {
        const walk = (base: string): void => {
          next.push(base);
          for (const e of readDir(base)) if (e.isDir) walk(join(base, e.name));
        };
        walk(d);
        continue;
      }
      const re = segmentRegExp(seg);
      for (const e of readDir(d)) {
        if (!re.test(e.name)) continue;
        if (isLast ? !e.isDir : e.isDir) next.push(join(d, e.name));
      }
    }
    dirs = next;
  }

  return [...new Set(dirs)];
}
