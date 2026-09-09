'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from '@/lib/auth-client';
import { apiFetch, type BatchDetail, type TaskResultRow } from '@/lib/api';

const VERDICT_ORDER: TaskResultRow['verdict'][] = ['problem', 'inconclusive', 'clean'];

const VERDICT_META: Record<TaskResultRow['verdict'], { label: string; tone: string; dot: string }> = {
  problem: { label: 'violated', tone: 'text-amber', dot: 'bg-amber' },
  inconclusive: { label: 'unproven', tone: 'text-slate-verdict', dot: 'bg-slate-verdict' },
  clean: { label: 'proven', tone: 'text-patina-bright', dot: 'bg-patina' },
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

  if (isPending || !session) return <div className="flex min-h-[100dvh] items-center justify-center text-paper-dim">Loading.</div>;

  return (
    <div className="min-h-[100dvh]">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <Link href="/dashboard" className="text-sm text-paper-dim hover:text-paper">
            &larr; Projects
          </Link>
          <button onClick={() => signOut().then(() => (location.href = '/'))} className="text-sm text-paper-dim hover:text-paper">
            Sign out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-12">
        {error && <p className="text-sm text-amber">{error}</p>}
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
        <h1 className="font-display text-2xl text-paper">Batch</h1>
        <p className="mt-1 font-mono text-xs text-paper-faint">
          {batch.id} &middot; {new Date(batch.uploadedAt).toLocaleString()}
          {batch.source ? ` · ${batch.source}` : ''}
        </p>
        <div className="mt-5 grid grid-cols-4 gap-3 text-center">
          <Stat label="tasks" value={batch.taskCount} tone="text-paper" />
          <Stat label="proven" value={batch.cleanCount} tone="text-patina-bright" />
          <Stat label="violated" value={batch.problematic} tone="text-amber" />
          <Stat label="unproven" value={batch.inconclusive} tone="text-slate-verdict" />
        </div>
        {batch.unreadableLines > 0 && (
          <p className="mt-3 text-xs text-amber">
            {batch.unreadableLines} line(s) in the upload could not be read and are not counted.
          </p>
        )}
      </div>

      <p className="glass-quiet rounded-xl p-4 text-xs leading-relaxed text-paper-dim">
        This view shows the shape of each finding, not the value inside it. The personal data in an answer (an
        invented email, a snippet of output) is never stored on the free tier. To see the answer beside its
        source with every atom lit, run <code className="font-mono text-paper">silentgreen check</code> locally,
        where the data never leaves your machine.
      </p>

      <ol className="space-y-3">
        {sorted.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ol>
    </div>
  );
}

function TaskRow({ task }: { task: TaskResultRow }) {
  const meta = VERDICT_META[task.verdict];
  return (
    <li className="glass rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
          <code className="font-mono text-sm text-paper">{task.taskId}</code>
        </div>
        <span className={`font-mono text-xs ${meta.tone}`}>{meta.label}</span>
      </div>

      {task.problems.length > 0 && (
        <ul className="mt-3 space-y-2 border-l border-line pl-4">
          {task.problems.map((p) => (
            <li key={p.id} className="text-sm">
              <span className="font-mono text-xs text-paper-faint">{p.kind}</span>
              <p className="text-paper-dim">{p.summary}</p>
              <p className="mt-0.5 font-mono text-xs text-paper-faint">{p.evidenceRedacted}</p>
            </li>
          ))}
        </ul>
      )}

      {task.verdict === 'inconclusive' && task.inconclusiveReason && (
        <p className="mt-3 border-l border-line pl-4 text-sm text-paper-dim">{task.inconclusiveReason}</p>
      )}

      {task.verdict === 'clean' && (
        <p className="mt-2 text-xs text-paper-faint">
          {task.atomsChecked} checkable fact(s), all traced to the source. Not a claim that the answer is good.
        </p>
      )}
    </li>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="glass-quiet rounded-lg py-3">
      <div className={`font-display text-xl ${tone}`}>{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-paper-faint">{label}</div>
    </div>
  );
}
