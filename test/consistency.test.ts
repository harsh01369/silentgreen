import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkConsistency } from '../src/verify/consistency';

const kinds = (s: string) => checkConsistency(s).map((i) => i.kind);

describe('an answer that contradicts itself', () => {
  test('a subtotal and tax that do not reach the stated total', () => {
    assert.deepEqual(kinds('Subtotal £400.00, VAT £80.00, total due £520.00.'), ['arithmetic']);
  });

  test('two different figures for the total', () => {
    assert.deepEqual(kinds('Your total is £560.00. The amount due is £650.00.'), ['restated-value']);
  });

  test('a due date before the issue date', () => {
    assert.deepEqual(kinds('Issued 2026-09-20, due 2026-09-05.'), ['date-order']);
  });

  test('a stated percentage that does not match the amount', () => {
    assert.deepEqual(kinds('Subtotal £500.00 and VAT at 20% comes to £120.00.'), ['percentage']);
  });
});

describe('not crying wolf', () => {
  test('figures that add up are left alone', () => {
    assert.deepEqual(checkConsistency('Subtotal £571.00, VAT £114.20, total £685.20.'), []);
  });

  test('a shipping line the answer mentions bridges the sum', () => {
    assert.deepEqual(checkConsistency('Subtotal £400.00, shipping £15.00, VAT £83.00, total £498.00.'), []);
  });

  test('a discount the answer mentions bridges the sum', () => {
    assert.deepEqual(checkConsistency('Subtotal £400.00 less a £40.00 discount, VAT £72.00, total £432.00.'), []);
  });

  test('issue then due, in order, is fine', () => {
    assert.deepEqual(checkConsistency('Issued 2026-09-01, due 2026-09-30.'), []);
  });

  test('"total" inside "subtotal" is not read as the total', () => {
    // Only a subtotal and a tax, no total stated: nothing to check against.
    assert.deepEqual(checkConsistency('The subtotal is £400.00 and VAT is £80.00.'), []);
  });

  test('rounding on a percentage is tolerated', () => {
    assert.deepEqual(checkConsistency('Subtotal £571.00, VAT at 20% is £114.20.'), []);
  });

  test('an empty answer produces nothing', () => {
    assert.deepEqual(checkConsistency(''), []);
  });
});
