import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractTrace } from '../src/aiwork/adapters';
import { parseTaskRecords } from '../src/aiwork/record';

describe('LangSmith run shapes', () => {
  test('a chain run with inputs/outputs objects', () => {
    const run = {
      id: 'run-1',
      run_type: 'chain',
      start_time: '2026-09-01T10:00:00Z',
      inputs: { question: 'What is the balance on INV-5501?' },
      outputs: { output: 'The balance is 539.00 GBP.' },
    };
    const t = extractTrace(run);
    assert.equal(t.input, 'What is the balance on INV-5501?');
    assert.equal(t.output, 'The balance is 539.00 GBP.');
    assert.equal(t.id, 'run-1');
    assert.equal(t.at, '2026-09-01T10:00:00Z');
  });

  test('an LLM run with generations', () => {
    const run = {
      inputs: { messages: [[{ kwargs: { content: 'Summarise the invoice.' } }]] },
      outputs: { generations: [[{ text: 'Total due is 685.20.' }]] },
    };
    const t = extractTrace(run);
    assert.equal(t.input, 'Summarise the invoice.');
    assert.equal(t.output, 'Total due is 685.20.');
  });

  test('retrieved documents come from a child retriever run', () => {
    const run = {
      inputs: { input: 'What does the customer owe?' },
      outputs: { output: 'They owe 539.00 GBP.' },
      child_runs: [
        {
          run_type: 'retriever',
          name: 'VectorStoreRetriever',
          outputs: { documents: [{ page_content: 'Invoice INV-5501 total 539.00 GBP' }, { page_content: 'Due 2026-09-13' }] },
        },
        { run_type: 'llm', name: 'ChatOpenAI', outputs: { generations: [[{ text: 'ignored' }]] } },
      ],
    };
    const t = extractTrace(run);
    assert.deepEqual(t.sources, ['Invoice INV-5501 total 539.00 GBP', 'Due 2026-09-13']);
  });
});

describe('Langfuse trace shapes', () => {
  test('singular input/output with a retrieval observation', () => {
    const trace = {
      traceId: 't-9',
      timestamp: '2026-09-02T09:00:00.000000Z',
      input: { question: 'When is it due?' },
      output: 'It is due on 2026-09-13.',
      observations: [
        { type: 'SPAN', name: 'retrieve-context', output: { documents: ['Invoice due 2026-09-13'] } },
        { type: 'GENERATION', name: 'answer', output: 'It is due on 2026-09-13.' },
      ],
    };
    const t = extractTrace(trace);
    assert.equal(t.input, 'When is it due?');
    assert.equal(t.output, 'It is due on 2026-09-13.');
    assert.deepEqual(t.sources, ['Invoice due 2026-09-13']);
    assert.equal(t.id, 't-9');
  });
});

describe('the parser routes trace shapes through the adapter', () => {
  test('a JSONL file of LangSmith runs is read end to end', () => {
    const line = JSON.stringify({
      id: 'r1',
      inputs: { question: 'balance?' },
      outputs: { output: 'The balance is £742.60.' },
      child_runs: [{ run_type: 'retriever', outputs: { documents: [{ page_content: 'Total 539.00 GBP' }] } }],
    });
    const { records, issues } = parseTaskRecords(line);
    assert.equal(issues.length, 0);
    assert.equal(records[0]!.output, 'The balance is £742.60.');
    assert.equal(records[0]!.sources[0], 'Total 539.00 GBP');
  });

  test('an already-flat record is untouched by the adapter', () => {
    const { records } = parseTaskRecords(JSON.stringify({ id: 'x', input: 'q', sources: ['s'], output: 'o' }));
    assert.equal(records[0]!.output, 'o');
    assert.deepEqual(records[0]!.sources, ['s']);
  });

  test('a trace with no recoverable answer is reported, not dropped', () => {
    const { records, issues } = parseTaskRecords(JSON.stringify({ inputs: { question: 'q' }, outputs: {} }));
    assert.equal(records.length, 0);
    assert.equal(issues.length, 1);
  });
});
