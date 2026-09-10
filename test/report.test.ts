import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderEvidenceReport, evidenceHash } from '../src/aiwork/report';
import { checkBatch } from '../src/aiwork/check';
import { parseContract, evaluateContract, promptSha } from '../src/aiwork/contract';
import type { TaskRecord } from '../src/aiwork/record';

const SRC = 'Invoice INV-1. Issued 2026-08-14, due 2026-09-13. Total due £600.00.';

function batch(): TaskRecord[] {
  return [
    { id: 'ok', input: 'q', sources: [SRC], output: 'Your balance is £600.00, due 2026-09-13.' },
    { id: 'bad', input: 'q', sources: [SRC], output: 'Your balance is £999.00, due 2026-12-31.' },
  ];
}

describe('the evidence record', () => {
  test('it is a self-contained HTML document with no external assets or scripts', () => {
    const html = renderEvidenceReport({ records: batch(), batchLabel: 'test.jsonl' });
    assert.match(html, /^<!doctype html>/i);
    assert.doesNotMatch(html, /<script(?![^>]*type="application)/i);
    assert.doesNotMatch(html, /https?:\/\/(?!www\.w3)/); // no remote asset URLs
    assert.match(html, /silentgreen evidence record/);
  });

  test('it leads with the coverage statement, before any finding', () => {
    const html = renderEvidenceReport({ records: batch(), batchLabel: 'b' });
    assert.ok(html.indexOf('What these checks can and cannot show') < html.indexOf('Findings ('));
  });

  test('redacted by default: no personal value, but the shape and offsets are kept', () => {
    const html = renderEvidenceReport({ records: batch(), batchLabel: 'b' });
    assert.doesNotMatch(html, /£999\.00/);
    assert.match(html, /a monetary amount, \d+ characters, absent from the source/);
    assert.match(html, /chars \d+–\d+/);
  });

  test('--full keeps the literal evidence', () => {
    const html = renderEvidenceReport({ records: batch(), batchLabel: 'b', redact: false });
    assert.match(html, /£999\.00/);
  });

  test('the hash is deterministic and content-sensitive', () => {
    const { summary: s1 } = checkBatch(batch());
    const h1 = evidenceHash({ records: batch(), batchLabel: 'b' }, s1);
    const h2 = evidenceHash({ records: batch(), batchLabel: 'b' }, s1);
    assert.equal(h1, h2);

    const changed = batch();
    changed[1] = { ...changed[1]!, output: 'Your balance is £600.00, due 2026-09-13.' };
    const { summary: s2 } = checkBatch(changed);
    const h3 = evidenceHash({ records: changed, batchLabel: 'b' }, s2);
    assert.notEqual(h1, h3);
  });

  test('a contract, when supplied, appears with its attestation and any staleness', () => {
    const prompt = 'You are a billing assistant. Answer only from the invoice.';
    const c = parseContract(
      `pipeline: billing\nbasis: intent\nattests: "Harsh 2026-09 contracted rules"\nbound_to:\n  prompt: p.txt\n  prompt_sha: ${promptSha(prompt)}\noutput:\n  predicates:\n    - "date within 90 days"\n`,
      'c',
    ).contract!;
    const cr = evaluateContract(c, batch(), { promptText: prompt + ' Always add a greeting.' });
    const html = renderEvidenceReport({ records: batch(), batchLabel: 'b', contract: cr });
    assert.match(html, /Against the contract: billing/);
    assert.match(html, /Harsh 2026-09 contracted rules/);
    assert.match(html, /has changed/); // the staleness banner
  });
});
