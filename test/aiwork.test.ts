import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseTaskRecords, groundingSourcesFor } from '../src/aiwork/record';
import { checkBatch, looksDeferred } from '../src/aiwork/check';
import { demoTasks } from '../src/aiwork/demo';

describe('reading whatever the pipeline exported', () => {
  test('plain jsonl is read', () => {
    const { records, issues } = parseTaskRecords(
      ['{"id":"a","input":"q","sources":["s"],"output":"o"}', '{"id":"b","input":"q2","output":"o2"}'].join('\n'),
    );
    assert.equal(records.length, 2);
    assert.equal(issues.length, 0);
    assert.equal(records[0]!.sources[0], 's');
  });

  test('a JSON array is read too', () => {
    const { records } = parseTaskRecords('[{"id":"a","output":"o"},{"id":"b","output":"o2"}]');
    assert.equal(records.length, 2);
  });

  test('other tools name these fields differently, and that is fine', () => {
    const { records } = parseTaskRecords(
      JSON.stringify({ trace_id: 'x1', prompt: 'what is owed?', completion: 'nothing', context: ['doc'] }),
    );
    assert.equal(records[0]!.id, 'x1');
    assert.equal(records[0]!.input, 'what is owed?');
    assert.equal(records[0]!.output, 'nothing');
    assert.equal(records[0]!.sources[0], 'doc');
  });

  test('documents wrapped as objects are unwrapped', () => {
    const { records } = parseTaskRecords(
      JSON.stringify({ output: 'answer', documents: [{ page_content: 'first' }, { text: 'second' }] }),
    );
    assert.deepEqual(records[0]!.sources, ['first', 'second']);
  });

  test('an output nested one level deep is found', () => {
    const { records } = parseTaskRecords(JSON.stringify({ id: 'a', response: { text: 'the answer' } }));
    assert.equal(records[0]!.output, 'the answer');
  });

  test('unreadable lines are reported rather than silently dropped', () => {
    const { records, issues } = parseTaskRecords(['{"output":"ok"}', 'not json at all', '{"no":"output here"}'].join('\n'));
    assert.equal(records.length, 1);
    assert.equal(issues.length, 2);
    assert.match(issues[1]!.reason, /No output found/);
    // A parser that quietly drops a third of the file and then reports no
    // problems would be an unusually poor joke in this codebase.
  });
});

describe('what counts as the source', () => {
  test('explicit sources are used when present', () => {
    const { sources, note } = groundingSourcesFor({ id: 'a', input: 'q', sources: ['doc'], output: 'o' });
    assert.deepEqual(sources, ['doc']);
    assert.equal(note, undefined);
  });

  test('with no sources the prompt is used, and the reader is told', () => {
    const { sources, note } = groundingSourcesFor({ id: 'a', input: 'the prompt', sources: [], output: 'o' });
    assert.deepEqual(sources, ['the prompt']);
    assert.match(note ?? '', /stricter than you may want/);
  });

  test('with neither, nothing is claimed', () => {
    const { sources, note } = groundingSourcesFor({ id: 'a', input: '', sources: [], output: 'o' });
    assert.deepEqual(sources, []);
    assert.match(note ?? '', /nothing could be checked/);
  });
});

describe('handing the work back', () => {
  test('a short answer that defers is caught', () => {
    assert.equal(looksDeferred('Please contact our support team and they will help you.').deferred, true);
    assert.equal(looksDeferred('I am transferring you to a human agent now.').deferred, true);
  });

  test('a complete answer that also mentions support is not a deferral', () => {
    const answer =
      'Your balance is £685.20 and it is due on 2026-09-13. You can pay through the billing portal using the link on the invoice. ' +
      'If the payment fails for any reason, please contact our support team and they will sort it out for you.';
    assert.equal(looksDeferred(answer).deferred, false, 'a helpful footnote is not a refusal to work');
  });

  test('a long answer is never a deferral', () => {
    assert.equal(looksDeferred(`I cannot help. ${'x'.repeat(500)}`).deferred, false);
  });
});

describe('the worked example', () => {
  const { results, summary } = checkBatch(demoTasks());

  test('every planted defect is caught and nothing else is', () => {
    const flagged = results.filter((r) => r.problems.length > 0).map((r) => r.id);
    assert.deepEqual(flagged, [
      'task-004', // confidently fabricated figures and contact
      'task-008', // template never rendered
      'task-012', // refusal carried downstream as content
      'task-015', // deferred to a human, scores as complete
      'task-017', // the pipeline stopped reading its input
      'task-018',
      'task-019',
    ]);
    assert.equal(summary.clean, 13, 'the thirteen faithful answers must not be accused');
  });

  test('the fabricated answer names the invented values', () => {
    const t4 = results.find((r) => r.id === 'task-004')!;
    const evidence = t4.problems.map((p) => p.evidence).join(' ');
    assert.match(evidence, /742\.60|finance@fernweh\.example/);
  });

  test('the duplicated answers explain what a repeat means', () => {
    const t17 = results.find((r) => r.id === 'task-017')!;
    assert.ok(t17.problems.some((p) => p.kind === 'duplicated' && /stopped reading its input/.test(p.summary)));
  });

  test('the summary refuses to call a clean result good work', () => {
    assert.match(summary.caveat, /does not check whether the answer is wise, complete or appropriate/);
    assert.match(summary.caveat, /No model was asked to grade another model/);
  });
});

describe('three identical answers is a finding at any batch size', () => {
  test('a small batch still reports duplicates', () => {
    const records = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      input: `question ${i}`,
      sources: [`source ${i} with the number ${100 + i}`],
      output: i < 3 ? 'Your request has been received and is being processed.' : `The value is ${100 + i}.`,
    }));
    const { results } = checkBatch(records);
    const dupes = results.filter((r) => r.problems.some((p) => p.kind === 'duplicated'));
    assert.equal(dupes.length, 3);
  });
});
