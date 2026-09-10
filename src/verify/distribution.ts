/**
 * What the batch looks like as a whole.
 *
 * Some failures are invisible one task at a time and obvious across a hundred.
 * A pipeline that defers a third of its tickets is not doing anything wrong on
 * any single answer, but it is not resolving anything either. A pipeline whose
 * answers have all collapsed to the same three sentences has stopped reading its
 * input. A batch where almost nothing carries a checkable fact is a batch that
 * groundedness cannot actually see, and saying so is more honest than a page of
 * green ticks.
 *
 * These are rates and shapes, computed from the batch itself. No source, no
 * history, no model. History-relative drift (this batch against last week) is a
 * hosted concern and lives in the service, not here.
 *
 * The bias matches the rest of the codebase: a signal is a note for a person to
 * look, not an accusation against a task. Nothing here marks an individual
 * answer as a problem or fails a CI job on its own.
 */

export type BatchSignalKind =
  | 'deferral-rate'
  | 'refusal-rate'
  | 'empty-rate'
  | 'collapse'
  | 'atom-drought'
  | 'length-outlier';

export interface BatchSignal {
  readonly kind: BatchSignalKind;
  /** `concern` is worth acting on; `notice` is worth a glance. */
  readonly severity: 'concern' | 'notice';
  /** One sentence, written for someone deciding whether to look closer. */
  readonly summary: string;
  /** A few task ids that exhibit it, so the reader knows where to start. */
  readonly sampleTaskIds: readonly string[];
}

/** The per-task facts the batch view is computed from. */
export interface TaskSignal {
  readonly id: string;
  readonly output: string;
  readonly deferred: boolean;
  readonly refused: boolean;
  readonly empty: boolean;
  readonly atomsChecked: number;
  /** True when groundedness actually ran (there was source material). */
  readonly grounded: boolean;
}

/** A batch smaller than this cannot support a rate argument. */
const MIN_BATCH = 8;

function fingerprint(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 400);
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Median absolute deviation, the robust cousin of standard deviation. */
function mad(xs: readonly number[], mid: number): number {
  if (xs.length === 0) return 0;
  return median(xs.map((x) => Math.abs(x - mid)));
}

function rate(count: number, total: number): number {
  return total > 0 ? count / total : 0;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function checkDistribution(tasks: readonly TaskSignal[]): readonly BatchSignal[] {
  const out: BatchSignal[] = [];
  const n = tasks.length;
  if (n < MIN_BATCH) return out;

  const deferred = tasks.filter((t) => t.deferred);
  const refused = tasks.filter((t) => t.refused);
  const empty = tasks.filter((t) => t.empty);

  if (deferred.length >= 3 && rate(deferred.length, n) >= 0.25) {
    out.push({
      kind: 'deferral-rate',
      severity: 'concern',
      summary: `${deferred.length} of ${n} answers (${pct(rate(deferred.length, n))}) hand the task back to a human. Each one counts as a completed task, so a high resolution rate here means very little.`,
      sampleTaskIds: deferred.slice(0, 5).map((t) => t.id),
    });
  }

  if (refused.length >= 3 && rate(refused.length, n) >= 0.2) {
    out.push({
      kind: 'refusal-rate',
      severity: 'concern',
      summary: `${refused.length} of ${n} answers (${pct(rate(refused.length, n))}) are refusals carried downstream as content. That points at a prompt, a permission, or an upstream data problem rather than at any one answer.`,
      sampleTaskIds: refused.slice(0, 5).map((t) => t.id),
    });
  }

  if (empty.length >= 2 && rate(empty.length, n) >= 0.15) {
    out.push({
      kind: 'empty-rate',
      severity: 'concern',
      summary: `${empty.length} of ${n} answers (${pct(rate(empty.length, n))}) are empty or a bare null. The pipeline is recording a result where there is none.`,
      sampleTaskIds: empty.slice(0, 5).map((t) => t.id),
    });
  }

  // Collapse: one near-identical answer dominating the batch. Exact duplicates
  // are already reported per task; this catches the softer case where the
  // pipeline returns one of a tiny handful of canned replies.
  const clusters = new Map<string, string[]>();
  for (const t of tasks) {
    if (t.empty) continue;
    const fp = fingerprint(t.output);
    let ids = clusters.get(fp);
    if (!ids) {
      ids = [];
      clusters.set(fp, ids);
    }
    ids.push(t.id);
  }
  let biggest: string[] = [];
  for (const ids of clusters.values()) if (ids.length > biggest.length) biggest = ids;
  if (biggest.length >= 5 && rate(biggest.length, n) >= 0.4) {
    out.push({
      kind: 'collapse',
      severity: 'concern',
      summary: `${biggest.length} of ${n} answers (${pct(rate(biggest.length, n))}) are the same response to different inputs. A pipeline that has stopped reading its input looks exactly like this.`,
      sampleTaskIds: biggest.slice(0, 5),
    });
  }

  // Atom drought: groundedness ran, but almost nothing in the batch carried a
  // checkable specific, so a clean groundedness result is close to vacuous.
  const groundedTasks = tasks.filter((t) => t.grounded);
  if (groundedTasks.length >= MIN_BATCH) {
    const barren = groundedTasks.filter((t) => t.atomsChecked === 0);
    if (rate(barren.length, groundedTasks.length) >= 0.7) {
      out.push({
        kind: 'atom-drought',
        severity: 'notice',
        summary: `${barren.length} of ${groundedTasks.length} answers contain no figure, date, identifier or name to check against the source. Groundedness has very little to work with in this batch, so a clean result is a weak signal here.`,
        sampleTaskIds: barren.slice(0, 5).map((t) => t.id),
      });
    }
  }

  // A single answer whose length is a stark outlier among its neighbours. Robust
  // z-score so a couple of odd answers do not move the centre.
  const lengths = tasks.filter((t) => !t.empty).map((t) => t.output.length);
  if (lengths.length >= MIN_BATCH) {
    const mid = median(lengths);
    const spread = mad(lengths, mid) * 1.4826 || 1;
    const outliers = tasks
      .filter((t) => !t.empty)
      .map((t) => ({ id: t.id, z: (t.output.length - mid) / spread }))
      .filter((t) => Math.abs(t.z) >= 6);
    if (outliers.length > 0 && outliers.length <= Math.max(2, Math.floor(n * 0.1))) {
      out.push({
        kind: 'length-outlier',
        severity: 'notice',
        summary: `${outliers.length} answer(s) are far shorter or longer than the rest of the batch. That is often where a truncation, a dump of raw context, or a different code path shows up.`,
        sampleTaskIds: outliers.slice(0, 5).map((t) => t.id),
      });
    }
  }

  return out;
}
