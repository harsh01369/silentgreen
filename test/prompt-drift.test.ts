import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseContract, evaluateContract, promptSha } from '../src/aiwork/contract';
import { draftContract } from '../src/aiwork/contract-draft';
import type { TaskRecord } from '../src/aiwork/record';

const PROMPT = 'You are a billing assistant. Answer only from the invoice provided. Never promise a refund.';

const SRC = 'Invoice INV-1. Issued 2026-08-14, due 2026-09-13. Total due GBP 600.00. Contact accounts@acme.example.';

function records(): TaskRecord[] {
  return Array.from({ length: 4 }, (_, i) => ({
    id: `t${i}`,
    input: PROMPT,
    sources: [SRC],
    output: 'Your balance is GBP 600.00, due on 2026-09-13.',
    at: '2026-08-20T09:00:00Z',
  }));
}

const CONTRACT = (sha: string) => `
pipeline: billing
basis: intent
attests: "Harsh, 2026-09, these are the contracted rules"
bound_to:
  prompt: system.txt
  prompt_sha: ${sha}
output:
  must_contain:
    - kind: money
    - kind: date
  predicates:
    - "date within 90 days"
`;

describe('a contract bound to a prompt', () => {
  test('when the prompt is unchanged, proven results stand', () => {
    const { contract } = parseContract(CONTRACT(promptSha(PROMPT)), 'c');
    const r = evaluateContract(contract!, records(), { promptText: PROMPT });
    assert.equal(r.stale, false);
    assert.equal(r.summary.proven, 4);
  });

  test('when the prompt has changed, every proven result becomes unproven', () => {
    const { contract } = parseContract(CONTRACT(promptSha(PROMPT)), 'c');
    const changed = PROMPT + ' Also, always sign off with the team name.';
    const r = evaluateContract(contract!, records(), { promptText: changed });
    assert.equal(r.stale, true);
    assert.match(r.staleReason!, /has changed/);
    assert.equal(r.summary.proven, 0);
    assert.equal(r.summary.unproven, 4);
  });

  test('a whitespace reflow of the prompt is not a change', () => {
    const { contract } = parseContract(CONTRACT(promptSha(PROMPT)), 'c');
    const reflowed = PROMPT.replace(/\. /g, '.\n   ');
    const r = evaluateContract(contract!, records(), { promptText: reflowed });
    assert.equal(r.stale, false);
  });

  test('without --prompt, drift is simply not checked', () => {
    const { contract } = parseContract(CONTRACT(promptSha(PROMPT)), 'c');
    const r = evaluateContract(contract!, records());
    assert.equal(r.stale, false);
    assert.equal(r.summary.proven, 4);
  });

  test('the draft binds to the prompt when one is given, and round-trips', () => {
    const draft = draftContract(records(), { pipeline: 'billing', prompt: { path: 'system.txt', text: PROMPT } });
    assert.match(draft, /bound_to:/);
    assert.match(draft, new RegExp(promptSha(PROMPT)));
    const withAttests = draft.replace(/TODO:.*/, 'Harsh 2026-09 the contracted rules"');
    const { contract, errors } = parseContract(withAttests, 'd.yaml');
    assert.deepEqual(errors, []);
    assert.equal(contract!.bound_to?.prompt_sha, promptSha(PROMPT));
  });
});
