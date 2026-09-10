'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from '@/lib/auth-client';
import { apiFetch, type BatchDetail, type TaskResultRow } from '@/lib/api';

const VERDICT_ORDER: TaskResultRow['verdict'][] = ['problem', 'inconclusive', 'clean'];

const VERDICT_META: Record<TaskResultRow['verdict'], { label: string; tone: string; dot: string }> = {
  problem: { label: 'violated', tone: 'text-absent', dot: 'bg-absent' },
  inconclusive: { label: 'unproven', tone: 'text-withheld', dot: 'bg-withheld' },
  clean: { label: 'proven', tone: 'text-traced', dot: 'bg-traced' },
};

export default function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [data, setData] = useState<BatchDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isPending && !session) router.replace('/login');
  }, [isPending, session, router]);

  useEffect(() => {
    if (!session) return;
    apiFetch<BatchDetail>(`/v1/batches/${id}`)
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, [session, id]);

  if (isPending || !session) return <div className="flex min-h-[100dvh] items-center justify-center text-ink-soft">Loading.</div>;

  return (
    <div className="min-h-[100dvh]">
      <header className="border-b border-rule">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm text-ink-soft hover:text-ink">
            &larr; Projects
          </Link>
          <button onClick={() => signOut().then(() => (location.href = '/'))} className="text-sm text-ink-soft hover:text-ink">
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        {error && <p className="text-sm text-absent">{error}</p>}
        {data && <BatchView data={data} />}
      </main>
    </div>
  );
}

function BatchView({ data }: { data: BatchDetail }) {
  const { batch, tasks } = data;
  const sorted = [...tasks].sort((a, b) => VERDICT_ORDER.indexOf(a.verdict) - VERDICT_ORDER.indexOf(b.verdict));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-2xl text-ink">Batch</h1>
        <p className="mt-1 font-mono text-xs text-ink-faint">
          {batch.id} &middot; {new Date(batch.uploadedAt).toLocaleString()}
          {batch.source ? ` · ${batch.source}` : ''}
        </p>
        <div className="mt-5 grid grid-cols-4 gap-3 text-center">
          <Stat label="tasks" value={batch.taskCount} tone="text-ink" />
          <Stat label="proven" value={batch.cleanCount} tone="text-traced" />
          <Stat label="violated" value={batch.problematic} tone="text-absent" />
          <Stat label="unproven" value={batch.inconclusive} tone="text-withheld" />
        </div>
        {batch.unreadableLines > 0 && (
          <p className="mt-3 text-xs text-absent">
            {batch.unreadableLines} line(s) in the upload could not be read and are not counted.
          </p>
        )}
      </div>

      {batch.signals && batch.signals.length > 0 && (
        <div className="space-y-2">
          <h2 className="font-serif text-sm text-ink-soft">Across the batch</h2>
          {batch.signals.map((s, i) => (
            <div key={i} className="panel-sunken rounded-xl p-4 text-sm text-ink-soft">
              <span className={s.severity === 'concern' ? 'text-absent' : 'text-withheld'}>
                {s.severity === 'concern' ? '! ' : '· '}
              </span>
              {s.summary}
              {s.sampleTaskIds.length > 0 && (
                <span className="ml-1 font-mono text-xs text-ink-faint">e.g. {s.sampleTaskIds.join(', ')}</span>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="panel-sunken rounded-xl p-4 text-xs leading-relaxed text-ink-soft">
        This view shows the shape of each finding, not the value inside it. The personal data in an answer (an
        invented email, a snippet of output) is never stored on the free tier. To see the answer beside its
        source with every atom lit, run <code className="font-mono text-ink">silentgreen check</code> locally,
        where the data never leaves your machine.
      </p>

      <ol className="space-y-3">
        {sorted.map((t) => (
          <TaskRow key={t.id} task={t} batchId={batch.id} />
        ))}
      </ol>
    </div>
  );
}

function TaskRow({ task, batchId }: { task: TaskResultRow; batchId: string }) {
  const meta = VERDICT_META[task.verdict];
  return (
    <li className="panel rounded-xl p-5">
      <div className="flex items-center justify-between">
        <Link href={`/dashboard/batch/${batchId}/task/${task.taskId}`} className="flex items-center gap-3 hover:opacity-80">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          <code className="font-mono text-sm text-ink underline decoration-rule underline-offset-4">{task.taskId}</code>
        </Link>
        <span className={`font-mono text-xs ${meta.tone}`}>{meta.label}</span>
      </div>

      {task.problems.length > 0 && (
        <ul className="mt-3 space-y-2 border-l border-rule pl-4">
          {task.problems.map((p) => (
            <li key={p.id} className="text-sm">
              <span className="font-mono text-xs text-ink-faint">{p.kind}</span>
              <p className="text-ink-soft">{p.summary}</p>
              <p className="mt-0.5 font-mono text-xs text-ink-faint">{p.evidenceRedacted}</p>
            </li>
          ))}
        </ul>
      )}

      {task.verdict === 'inconclusive' && task.inconclusiveReason && (
        <p className="mt-3 border-l border-rule pl-4 text-sm text-ink-soft">{task.inconclusiveReason}</p>
      )}

      {task.verdict === 'clean' && (
        <p className="mt-2 text-xs text-ink-faint">
          {task.atomsChecked} checkable fact(s), all traced to the source. Not a claim that the answer is good.
        </p>
      )}
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="panel-sunken rounded-lg py-3">
      <div className={`font-serif text-xl ${tone}`}>{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
    </div>
  );
}
