'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from '@/lib/auth-client';
import { apiFetch, type TaskDetail } from '@/lib/api';

const VERDICT: Record<string, { label: string; tone: string }> = {
  problem: { label: 'violated', tone: 'text-absent' },
  inconclusive: { label: 'unproven', tone: 'text-withheld' },
  clean: { label: 'proven', tone: 'text-traced' },
};

export default function TaskPage({ params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = use(params);
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [data, setData] = useState<TaskDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.replace('/login');
  }, [isPending, session, router]);

  useEffect(() => {
    if (!session) return;
    apiFetch<TaskDetail>(`/v1/batches/${id}/tasks/${taskId}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [session, id, taskId]);

  if (isPending || !session) {
    return <div className="flex min-h-[100dvh] items-center justify-center text-ink-soft">Loading.</div>;
  }

  return (
    <div className="min-h-[100dvh]">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4 font-mono text-xs">
          <Link href={`/dashboard/batch/${id}`} className="text-ink-soft hover:text-ink">
            &larr; batch
          </Link>
          <button onClick={() => signOut().then(() => (location.href = '/'))} className="text-ink-soft hover:text-ink">
            sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        {error && <p className="font-mono text-sm text-absent">{error}</p>}
        {data && <Inspector data={data} />}
      </main>
    </div>
  );
}

function Inspector({ data }: { data: TaskDetail }) {
  const { task, batch } = data;
  const meta = VERDICT[task.verdict] ?? VERDICT.inconclusive!;
  const spans = task.problems
    .filter((p) => p.span)
    .map((p) => ({ ...p.span!, kind: p.kind, summary: p.summary, redacted: p.evidenceRedacted }))
    .sort((a, b) => a.start - b.start);
  const other = task.problems.filter((p) => !p.span);

  return (
    <div className="space-y-8">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
          Exhibit &mdash; task {task.taskId}
        </p>
        <p className={`mt-1 font-mono text-sm ${meta.tone}`}>{meta.label}</p>
      </div>

      {/* The redacted skeleton: the shape of the answer, not its text. */}
      <section>
        <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">
          The answer &mdash; {task.answerChars} characters, not stored
        </p>
        <div className="panel-sunken mt-3 space-y-1.5 p-4">
          <Skeleton chars={task.answerChars} spans={spans} />
        </div>
        <p className="mt-2 font-mono text-[11px] text-ink-faint">
          {spans.length} finding{spans.length === 1 ? '' : 's'} marked at fixed positions in the answer.
        </p>
      </section>

      {spans.length > 0 && (
        <section>
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">Not in the source</p>
          <ol className="mt-3 space-y-3">
            {spans.map((s, i) => (
              <li key={i} className="border-l-2 border-absent/40 pl-3 text-sm">
                <span className="mr-1 font-mono text-absent">{i + 1}.</span>
                <span className="font-mono text-xs text-ink-faint">
                  {s.atomKind} at chars {s.start}&ndash;{s.end}
                </span>
                <p className="mt-0.5 text-ink-soft">{s.redacted}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {other.length > 0 && (
        <section>
          <p className="font-mono text-[11px] uppercase tracking-wider text-ink-faint">Other findings</p>
          <ul className="mt-3 space-y-2">
            {other.map((p) => (
              <li key={p.id} className="text-sm">
                <span className="font-mono text-xs text-ink-faint">{p.kind}</span>
                <p className="text-ink-soft">{p.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {task.verdict === 'inconclusive' && task.inconclusiveReason && (
        <p className="border-l-2 border-withheld/40 pl-3 text-sm text-ink-soft">{task.inconclusiveReason}</p>
      )}

      <p className="panel-sunken p-4 font-serif text-[15px] leading-relaxed text-ink-soft">
        This is the shape of each finding, never the value inside it. The answer and its source are not stored on
        the free tier. To read the answer beside its source with every atom lit, run{' '}
        <code className="font-mono text-ink">silentgreen inspect {batch.id ? 'your-export.jsonl' : ''}</code>{' '}
        locally, where the data never leaves your machine.
      </p>
    </div>
  );
}

/** A row of blocks the width of the answer, with the finding spans marked red. */
function Skeleton({ chars, spans }: { chars: number; spans: { start: number; end: number }[] }) {
  const width = Math.min(chars, 900);
  const scale = width > 0 ? 100 / width : 0;
  return (
    <div className="relative h-8 w-full overflow-hidden rounded-sm bg-rule/60">
      {spans.map((s, i) => (
        <span
          key={i}
          title={`chars ${s.start}–${s.end}`}
          className="absolute top-0 h-full bg-absent/70"
          style={{ left: `${Math.min(99, s.start * scale)}%`, width: `${Math.max(0.8, (s.end - s.start) * scale)}%` }}
        />
      ))}
      {spans.map((s, i) => (
        <span
          key={`n${i}`}
          className="absolute -top-0 font-mono text-[10px] text-ground-raised"
          style={{ left: `${Math.min(97, s.start * scale)}%` }}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
}
