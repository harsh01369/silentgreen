import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { builtinBatches } from '../src/eval/corpus';
import { scoreBatch, gate, DEFAULT_GATE } from '../src/eval/score';

describe('the labelled corpus gates every change', () => {
  const boards = builtinBatches().map(scoreBatch);

  test('no faithful answer is ever flagged as a problem', () => {
    for (const b of boards) {
      const fp = b.disagreements.filter((d) => d.kind === 'false-positive' && !d.knownGap);
      assert.equal(
        fp.length,
        0,
        `${b.batch} flagged ${fp.map((d) => d.id).join(', ')}: ${fp.map((d) => d.detail).join(' | ')}`,
      );
    }
  });

  test('the gate passes at the default thresholds', () => {
    const g = gate(boards, DEFAULT_GATE);
    assert.equal(g.ok, true, g.failures.join('\n'));
  });

  test('every planted fabrication is caught, with the right atom named', () => {
    const fab = boards.find((b) => b.batch === 'fabrication-adversarial')!;
    assert.equal(fab.falseNegatives, 0);
    assert.equal(fab.atomRecall, 1, `atom recall ${fab.atomRecall}`);
  });

  test('reformatted dates and money do not read as invented', () => {
    const faith = boards.find((b) => b.batch === 'faithful-adversarial')!;
    assert.equal(faith.falsePositives, 0);
    assert.equal(faith.knownGaps, 0, 'no undocumented gaps have crept in');
  });

  test('answers with no checkable specifics are inconclusive, not clean', () => {
    const inc = boards.find((b) => b.batch === 'inconclusive')!;
    assert.equal(inc.inconclusiveMismatch, 0);
  });

  test('the corpus is still marked synthetic until real batches replace it', () => {
    assert.ok(boards.every((b) => b.synthetic), 'a real batch has been added; update the honesty note in the README');
  });
});
