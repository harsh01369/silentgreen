import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseContract, evaluateContract } from '../src/aiwork/contract';
import { draftContract } from '../src/aiwork/contract-draft';
import type { TaskRecord } from '../src/aiwork/record';

const CONTRACT = `
pipeline: billing-support-agent
basis: intent
attests: "Harsh, 2026-09, these rules are what the agent is contracted to do"

output:
  must_contain:
    - kind: money
    - kind: date
  must_not_contain:
    - pattern: "refund|credit note"
  grounded:
    kinds: [money, date, email, url]
  predicates:
    - "money <= source.money.max"
    - "date within 90 days"
    - "currency == source.currency"

actions:
  - when: "emailed|sent (you )?the invoice"
    require:
      kind: email.sent
      target_matches: source.email
`;

const SOURCE =
  'Invoice INV-1 for Fernweh Supply Ltd. Issued 2026-08-14, due 2026-09-13. Billing contact: accounts@fernweh.example. Subtotal GBP 500.00. Total due GBP 600.00.';

function task(over: Partial<TaskRecord> & { id: string }): TaskRecord {
  return { input: 'what do I owe', sources: [SOURCE], output: '', at: '2026-08-20T09:00:00Z', ...over };
}

describe('parsing a contract', () => {
  test('a well-formed contract parses', () => {
    const { contract, errors } = parseContract(CONTRACT, 'billing.sg.yaml');
    assert.deepEqual(errors, []);
    assert.equal(contract?.pipeline, 'billing-support-agent');
    assert.equal(contract?.basis, 'intent');
    assert.equal(contract?.output?.must_contain?.length, 2);
    assert.equal(contract?.actions?.length, 1);
  });

  test('a missing attests line is refused', () => {
    const { errors } = parseContract('pipeline: p\nbasis: intent\n', 'x');
    assert.ok(errors.some((e) => /attests/.test(e)));
  });

  test('the draft placeholder attests is refused', () => {
    const { errors } = parseContract(
      'pipeline: p\nbasis: intent\nattests: "TODO: your name, the date, and how you know"\n',
      'x',
    );
    assert.ok(errors.some((e) => /placeholder/.test(e)));
  });

  test('an unknown basis is refused', () => {
    const { errors } = parseContract('pipeline: p\nbasis: vibes\nattests: "a real sentence here about it"\n', 'x');
    assert.ok(errors.some((e) => /basis/.test(e)));
  });

  test('JSON contracts are accepted too', () => {
    const json = JSON.stringify({ pipeline: 'p', basis: 'intent', attests: 'Harsh 2026-09 these are the rules', consistency: true });
    const { contract, errors } = parseContract(json, 'c.json');
    assert.deepEqual(errors, []);
    assert.equal(contract?.consistency, true);
  });
});

describe('evaluating a contract', () => {
  const { contract } = parseContract(CONTRACT, 'c');

  test('a faithful answer with the action recorded is proven', () => {
    const r = evaluateContract(contract!, [
      task({
        id: 't-ok',
        output: 'Your balance is GBP 600.00, due on 2026-09-13. I have emailed the invoice to accounts@fernweh.example.',
        actions: [{ kind: 'email.sent', target: 'accounts@fernweh.example', result: 'ok' }],
      }),
    ]);
    assert.equal(r.tasks[0]!.verdict, 'proven');
  });

  test('an inflated amount violates the money predicate', () => {
    const r = evaluateContract(contract!, [
      task({ id: 't-money', output: 'Your balance is GBP 950.00, due on 2026-09-13.' }),
    ]);
    assert.equal(r.tasks[0]!.verdict, 'violated');
    assert.ok(r.tasks[0]!.clauses.some((c) => c.clause.includes('money <= source.money.max') && c.verdict === 'violated'));
  });

  test('a promise to email with no action recorded is unproven, not violated', () => {
    const r = evaluateContract(contract!, [
      task({ id: 't-noact', output: 'Your balance is GBP 600.00, due 2026-09-13. I have emailed you the invoice.' }),
    ]);
    const actionClause = r.tasks[0]!.clauses.find((c) => c.clause.startsWith('when '));
    assert.equal(actionClause?.verdict, 'unproven');
  });

  test('a promise to email with actions recorded but none matching is violated', () => {
    const r = evaluateContract(contract!, [
      task({
        id: 't-wrongact',
        output: 'Your balance is GBP 600.00, due 2026-09-13. I have emailed you the invoice.',
        actions: [{ kind: 'ticket.closed', target: 'T-1' }],
      }),
    ]);
    const actionClause = r.tasks[0]!.clauses.find((c) => c.clause.startsWith('when '));
    assert.equal(actionClause?.verdict, 'violated');
  });

  test('a forbidden pattern is a violation', () => {
    const r = evaluateContract(contract!, [
      task({ id: 't-refund', output: 'Your balance is GBP 600.00, due 2026-09-13. We will issue a refund.' }),
    ]);
    assert.ok(r.tasks[0]!.clauses.some((c) => c.clause.includes('must not contain') && c.verdict === 'violated'));
  });

  test('a missing required field is a violation', () => {
    const r = evaluateContract(contract!, [task({ id: 't-nodate', output: 'Your balance is GBP 600.00.' })]);
    assert.ok(r.tasks[0]!.clauses.some((c) => c.clause === 'must contain a date' && c.verdict === 'violated'));
  });

  test('the attestation sentence rides along in the honesty line', () => {
    const r = evaluateContract(contract!, [task({ id: 't', output: 'x' })]);
    assert.match(r.honesty, /Harsh, 2026-09/);
  });
});

describe('drafting a contract', () => {
  test('the draft leaves attests as a placeholder that later fails to parse', () => {
    const records: TaskRecord[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      input: 'q',
      sources: ['Total due GBP 100.00, due 2026-09-30.'],
      output: 'Your balance is GBP 100.00, due on 2026-09-30.',
    }));
    const draft = draftContract(records, 'demo');
    assert.match(draft, /basis: intent/);
    assert.match(draft, /must_contain/);
    const { errors } = parseContract(draft, 'draft.yaml');
    assert.ok(errors.some((e) => /placeholder/.test(e)));
  });
});
