import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkConformance } from '../src/verify/conformance';

const kinds = (o: string, i = '') => checkConformance(o, i).map((m) => m.kind);

describe('an answer that was meant to be structured', () => {
  test('JSON wrapped in an apology is caught', () => {
    const out = 'Sure! Here is the data you asked for:\n{"status":"ok","count":3}';
    assert.deepEqual(kinds(out, 'Return the result as JSON'), ['json-with-surrounding-prose']);
  });

  test('a markdown fence around JSON is not itself a fault', () => {
    assert.deepEqual(kinds('```json\n{"a":1}\n```', 'respond in json'), []);
  });

  test('truncated JSON is caught', () => {
    assert.deepEqual(kinds('{"items":[{"id":1},{"id":2},{"id":', 'return json'), ['truncated']);
  });

  test('invalid JSON that looks like JSON is caught', () => {
    assert.deepEqual(kinds("{'status': 'ok', trailing,}"), ['unparseable-json']);
  });

  test('asked for JSON, answered in prose', () => {
    assert.deepEqual(kinds('The status is OK and there are three items.', 'Give the answer as valid JSON'), [
      'unparseable-json',
    ]);
  });

  test('a ragged markdown table is caught', () => {
    const table = ['| a | b | c |', '| - | - | - |', '| 1 | 2 | 3 |', '| 4 | 5 |'].join('\n');
    assert.deepEqual(kinds(table), ['ragged-table']);
  });
});

describe('leaving prose alone', () => {
  test('ordinary prose with a brace is not judged as JSON', () => {
    assert.deepEqual(checkConformance('The function returns an object like { id, name } for each row.'), []);
  });

  test('valid bare JSON is clean', () => {
    assert.deepEqual(checkConformance('{"status":"ok","items":[1,2,3]}'), []);
  });

  test('an even markdown table is clean', () => {
    const table = ['| a | b |', '| - | - |', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
    assert.deepEqual(checkConformance(table), []);
  });

  test('an empty answer produces nothing here', () => {
    assert.deepEqual(checkConformance(''), []);
  });
});
