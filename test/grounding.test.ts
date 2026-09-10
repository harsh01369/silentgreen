import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkGrounding, extractAtoms } from '../src/verify/grounding';

const INVOICE = `
Invoice INV-2026-0412 for Fernweh Supply Ltd.
Issued 2026-08-14, due 2026-09-13.
Contact: accounts@fernweh.example
Line items:
  Alpine 45 rucksack   x3   £129.00 each
  Storm shell jacket   x1   £184.00
Subtotal £571.00
VAT £114.20
Total due £685.20
Portal: https://billing.fernweh.example/inv/2026-0412
`;

function keys(out: ReturnType<typeof checkGrounding>) {
  return out.ungrounded.map((u) => u.text);
}

describe('an answer that came from the source', () => {
  test('a faithful summary is clean', () => {
    const answer =
      'Invoice INV-2026-0412 for Fernweh Supply Ltd is due 2026-09-13. The total due is £685.20, of which VAT is £114.20.';
    const r = checkGrounding(answer, [INVOICE]);
    assert.equal(r.inconclusive, false);
    assert.deepEqual(keys(r), [], `expected nothing flagged, got ${JSON.stringify(keys(r))}`);
  });

  test('number formatting differences are not fabrications', () => {
    const r = checkGrounding('The total is 685.20 and the subtotal is 571.', [INVOICE]);
    assert.deepEqual(keys(r), []);
  });

  test('case and spacing differences in a name are not fabrications', () => {
    const r = checkGrounding('We reviewed the account for fernweh supply ltd.', [INVOICE]);
    assert.deepEqual(keys(r), []);
  });

  test('a reformatted date is the same date', () => {
    const r = checkGrounding('The invoice is due on 13/09/2026.', [INVOICE]);
    assert.deepEqual(keys(r), [], 'day-first 13/09/2026 is the ISO 2026-09-13 in the source');
  });

  test('a genuinely different date is still caught', () => {
    const r = checkGrounding('The invoice is due on 30/09/2026.', [INVOICE]);
    assert.deepEqual(keys(r), ['30/09/2026']);
  });

  test('a number inside a quotation is not carved out from under it', () => {
    const source = 'Policy: refunds are issued within 14 days of the return being received.';
    const r = checkGrounding('The policy says "refunds are issued within 14 days" here.', [source]);
    assert.deepEqual(keys(r), [], 'the quote must be checked whole, with its 14 intact');
  });

  test('a figure written as words matches the same figure in digits', () => {
    assert.deepEqual(keys(checkGrounding('You owe two thousand pounds.', ['Total: 2000.00 GBP'])), []);
    assert.deepEqual(keys(checkGrounding('You owe £2,000.00.', ['The fee is two thousand pounds.'])), []);
  });

  test('a fabricated figure written as words is still caught', () => {
    assert.deepEqual(keys(checkGrounding('You owe five thousand pounds.', ['Total: 2000.00 GBP'])), ['five thousand']);
  });

  test('"one of the reasons" is not read as the number one', () => {
    assert.deepEqual(keys(checkGrounding('One of the reasons is cost.', ['a note about cost and speed'])), []);
  });
});

describe('an answer the model made up', () => {
  test('an invented total is caught, with the value quoted', () => {
    const answer = 'Invoice INV-2026-0412 is due 2026-09-13. The total due is £985.20.';
    const r = checkGrounding(answer, [INVOICE]);
    assert.equal(r.ungrounded.length, 1);
    assert.match(r.ungrounded[0]!.text, /985\.20/);
    assert.match(r.ungrounded[0]!.why, /monetary amount that appears nowhere/);
  });

  test('an invented identifier is caught, because anything keyed on it will not resolve', () => {
    const r = checkGrounding('Please see invoice INV-2026-9999 for details.', [INVOICE]);
    assert.equal(keys(r).length, 1);
    assert.match(keys(r)[0]!, /INV-2026-9999/);
    assert.match(r.ungrounded[0]!.why, /will not resolve/);
  });

  test('an invented email address is caught', () => {
    const r = checkGrounding('I have emailed billing@fernweh.example about it.', [INVOICE]);
    assert.ok(keys(r).some((k) => k.includes('billing@fernweh.example')));
  });

  test('an invented link is caught', () => {
    const r = checkGrounding('The portal is at https://pay.fernweh.example/now', [INVOICE]);
    assert.ok(keys(r).some((k) => k.includes('pay.fernweh.example')));
    assert.match(r.ungrounded[0]!.why, /invented links/);
  });

  test('a quotation that is not in the source is caught', () => {
    const r = checkGrounding(
      'The invoice states "payment is due within ninety days of issue" on page one.',
      [INVOICE],
    );
    assert.ok(r.ungrounded.some((u) => u.kind === 'quote'));
  });

  test('a real quotation with different punctuation is not caught', () => {
    const src = 'The customer wrote: payment is due within thirty days, no exceptions.';
    const r = checkGrounding('They said "payment is due within thirty days no exceptions".', [src]);
    assert.equal(r.ungrounded.filter((u) => u.kind === 'quote').length, 0);
  });
});

describe('refusing to cry wolf', () => {
  test('a sentence-starting capital is not treated as a name', () => {
    const r = checkGrounding('Based on the invoice, the total is £685.20. However the VAT is £114.20.', [INVOICE]);
    assert.deepEqual(keys(r), [], `false positives: ${JSON.stringify(keys(r))}`);
  });

  test('months and weekdays are not names', () => {
    const r = checkGrounding('Payment is expected in September, probably on a Friday.', [INVOICE]);
    assert.equal(r.ungrounded.filter((u) => u.kind === 'name').length, 0);
  });

  test('small counting numbers are ignored', () => {
    const r = checkGrounding('There are 2 line items and 3 rucksacks.', [INVOICE]);
    assert.equal(r.ungrounded.filter((u) => u.kind === 'number').length, 0);
  });

  test('an email is not also reported as a stray number or name', () => {
    const atoms = extractAtoms('Write to accounts@fernweh.example about invoice 2026.');
    assert.equal(atoms.filter((a) => a.kind === 'email').length, 1);
    assert.equal(atoms.filter((a) => a.text.includes('fernweh') && a.kind === 'name').length, 0);
  });
});

describe('declining to answer rather than guessing', () => {
  test('no source material is inconclusive, not clean', () => {
    const r = checkGrounding('The total is £685.20.', []);
    assert.equal(r.inconclusive, true);
    assert.match(r.reason ?? '', /gap in the evidence rather than a clean result/);
    assert.deepEqual(r.ungrounded, []);
  });

  test('prose with no specifics is inconclusive', () => {
    const r = checkGrounding('It looks broadly fine and I would proceed as discussed.', [INVOICE]);
    assert.equal(r.inconclusive, true);
    assert.match(r.reason ?? '', /too few to conclude anything/);
  });

  test('an inconclusive result never reports fabrications', () => {
    const r = checkGrounding('Fine.', [INVOICE]);
    assert.equal(r.ungrounded.length, 0);
  });
});

describe('narrowing what is checked', () => {
  test('kinds can be restricted when a corpus is noisy', () => {
    const answer = 'Contact Priya Sharma about the £985.20 balance.';
    const all = checkGrounding(answer, [INVOICE]);
    assert.ok(all.ungrounded.length >= 2, 'both the name and the amount are ungrounded');

    const moneyOnly = checkGrounding(answer, [INVOICE], { kinds: ['money'] });
    assert.equal(moneyOnly.ungrounded.length, 1);
    assert.equal(moneyOnly.ungrounded[0]!.kind, 'money');
  });
});

describe('the failure this exists for', () => {
  test('a confident, well-formed, entirely fabricated answer is caught', () => {
    // The 2026 post-mortem phrasing: agents "learned to produce confident-sounding
    // but factually incorrect responses because the evaluation framework couldn't
    // distinguish between confident correctness and confident fabrication".
    // Nothing about this answer's shape, tone or length is wrong.
    const answer = `Summary: Invoice INV-2026-0518 for Fernweh Supply Ltd was issued on 2026-08-02
and is due on 2026-09-01. The outstanding balance is £742.60, including VAT of £123.77.
The account contact is finance@fernweh.example.`;
    const r = checkGrounding(answer, [INVOICE]);
    assert.equal(r.inconclusive, false);
    assert.ok(r.ungrounded.length >= 5, `expected the invented facts to be caught, got ${JSON.stringify(keys(r))}`);
    assert.ok(keys(r).some((k) => k.includes('INV-2026-0518')));
    assert.ok(keys(r).some((k) => k.includes('742.60')));
    assert.ok(keys(r).some((k) => k.includes('finance@fernweh.example')));
  });
});

describe('sentence punctuation is not part of the fact', () => {
  test('a URL at the end of a sentence is not reported as invented', () => {
    // This bug flagged fourteen faithful answers in the worked example: the
    // pattern swallowed the full stop, the result no longer matched the source,
    // and correct work was accused of fabricating links.
    const src = 'Portal: https://billing.fernweh.example/inv/2026-0400';
    const r = checkGrounding('You can view it at https://billing.fernweh.example/inv/2026-0400.', [src]);
    assert.deepEqual(r.ungrounded.filter((u) => u.kind === 'url').map((u) => u.text), []);
  });

  test('an email followed by a comma is not reported as invented', () => {
    const src = 'Billing contact: accounts@fernweh.example';
    const r = checkGrounding('Write to accounts@fernweh.example, and they will help.', [src]);
    assert.deepEqual(r.ungrounded.filter((u) => u.kind === 'email').map((u) => u.text), []);
  });

  test('an identifier in parentheses is not reported as invented', () => {
    const src = 'Invoice INV-2026-0412 issued.';
    const r = checkGrounding('See the invoice (INV-2026-0412).', [src]);
    assert.deepEqual(r.ungrounded.filter((u) => u.kind === 'identifier').map((u) => u.text), []);
  });

  test('a genuinely invented URL is still caught after trimming', () => {
    const src = 'Portal: https://billing.fernweh.example/inv/2026-0400';
    const r = checkGrounding('Pay at https://pay.fernweh.example/now.', [src]);
    assert.ok(r.ungrounded.some((u) => u.kind === 'url' && u.text === 'https://pay.fernweh.example/now'));
  });
});

describe('company suffixes are interchangeable', () => {
  test('"Limited" in the answer matches "Ltd" in the source', () => {
    const src = 'Invoice for Fernweh Supply Ltd. Total due GBP 685.20.';
    const r = checkGrounding('Your account with Fernweh Supply Limited has GBP 685.20 outstanding.', [src]);
    assert.deepEqual(r.ungrounded.filter((u) => u.kind === 'name').map((u) => u.text), []);
  });

  test('the suffix dropped entirely still matches', () => {
    const src = 'Account holder: Northwind Traders GmbH.';
    const r = checkGrounding('This relates to Northwind Traders.', [src]);
    assert.deepEqual(r.ungrounded.filter((u) => u.kind === 'name').map((u) => u.text), []);
  });

  test('a genuinely different company is still caught', () => {
    const src = 'Invoice for Fernweh Supply Ltd.';
    const r = checkGrounding('Your account with Contoso Logistics Limited is overdue.', [src]);
    assert.ok(r.ungrounded.some((u) => u.kind === 'name' && /Contoso/.test(u.text)));
  });
});

describe('a near-miss figure is explained, not just flagged', () => {
  test('a transposed total points at the real one', () => {
    const src = 'Subtotal £539.00. Total due £539.00.';
    const r = checkGrounding('Your balance is £593.00.', [src]);
    const hit = r.ungrounded.find((u) => u.kind === 'money' || u.kind === 'number');
    assert.ok(hit);
    assert.match(hit!.why, /closest figure in the source is 539/);
  });
});
