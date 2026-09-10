import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml } from '../src/util/yaml';

describe('the small YAML reader', () => {
  test('a flat mapping with typed scalars', () => {
    const { value, errors } = parseYaml('pipeline: billing\nbasis: intent\ncount: 12\nratio: 0.5\nactive: true\nnothing: null\n');
    assert.deepEqual(errors, []);
    assert.deepEqual(value, { pipeline: 'billing', basis: 'intent', count: 12, ratio: 0.5, active: true, nothing: null });
  });

  test('nested mappings and lists', () => {
    const text = [
      'output:',
      '  must_contain:',
      '    - kind: money',
      '    - kind: date',
      '  grounded:',
      '    kinds: [money, date]',
      'actions:',
      '  - when: emailed',
      '    require:',
      '      kind: email.sent',
    ].join('\n');
    const { value, errors } = parseYaml(text);
    assert.deepEqual(errors, []);
    assert.deepEqual(value, {
      output: {
        must_contain: [{ kind: 'money' }, { kind: 'date' }],
        grounded: { kinds: ['money', 'date'] },
      },
      actions: [{ when: 'emailed', require: { kind: 'email.sent' } }],
    });
  });

  test('quoted scalars keep their spaces and colons', () => {
    const { value } = parseYaml('attests: "Harsh, 2026-09: these are the contracted rules"\n');
    assert.deepEqual(value, { attests: 'Harsh, 2026-09: these are the contracted rules' });
  });

  test('a block scalar for multi-line prose', () => {
    const text = 'attests: |\n  Reconciled against the client\n  invoice export for March\n';
    const { value } = parseYaml(text);
    assert.equal((value as Record<string, string>).attests, 'Reconciled against the client\ninvoice export for March');
  });

  test('trailing comments are stripped, colons in quotes are not', () => {
    const { value } = parseYaml('a: 1   # a comment\nb: "x: y"  # another\n');
    assert.deepEqual(value, { a: 1, b: 'x: y' });
  });

  test('tabs are rejected with a line number', () => {
    const { errors } = parseYaml('a:\n\tb: 1\n');
    assert.ok(errors.some((e) => /line 2/.test(e) && /tab/i.test(e)));
  });
});
