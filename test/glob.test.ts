import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expandGlob } from '../src/util/glob';

describe('expandGlob', () => {
  const root = mkdtempSync(join(tmpdir(), 'sg-glob-'));
  mkdirSync(join(root, 'a'));
  mkdirSync(join(root, 'a', 'deep'));
  mkdirSync(join(root, 'b'));
  writeFileSync(join(root, 'a', 'one.jsonl'), '');
  writeFileSync(join(root, 'a', 'note.txt'), '');
  writeFileSync(join(root, 'a', 'deep', 'two.jsonl'), '');
  writeFileSync(join(root, 'b', 'three.jsonl'), '');

  test('a literal path is returned unchanged', () => {
    assert.deepEqual(expandGlob(join(root, 'a', 'one.jsonl')), [join(root, 'a', 'one.jsonl')]);
  });

  test('* matches within one directory and respects the extension', () => {
    const hits = expandGlob(join(root, 'a', '*.jsonl'));
    assert.deepEqual(hits, [join(root, 'a', 'one.jsonl')]);
  });

  test('** descends into subdirectories', () => {
    const hits = expandGlob(join(root, '**', '*.jsonl')).sort();
    assert.deepEqual(hits, [join(root, 'a', 'deep', 'two.jsonl'), join(root, 'a', 'one.jsonl'), join(root, 'b', 'three.jsonl')].sort());
  });

  test('a pattern that matches nothing returns empty', () => {
    assert.deepEqual(expandGlob(join(root, 'a', '*.csv')), []);
  });

  test('? matches a single character', () => {
    mkdirSync(join(root, 'runs'));
    writeFileSync(join(root, 'runs', 'r1.json'), '');
    writeFileSync(join(root, 'runs', 'r2.json'), '');
    writeFileSync(join(root, 'runs', 'r10.json'), '');
    assert.deepEqual(expandGlob(join(root, 'runs', 'r?.json')).sort(), [join(root, 'runs', 'r1.json'), join(root, 'runs', 'r2.json')].sort());
  });
});
