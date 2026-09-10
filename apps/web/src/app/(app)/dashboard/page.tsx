'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { authClient, useSession, signOut } from '@/lib/auth-client';
import { apiFetch, type Project, type ProjectSummary } from '@/lib/api';

export default function Dashboard() {
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [needsOrg, setNeedsOrg] = useState(false);

  useEffect(() => {
    if (!isPending && !session) router.replace('/login');
  }, [isPending, session, router]);

  useEffect(() => {
    if (!session) return;
    authClient.organization.list().then(({ data }) => {
      const first = data?.[0];
      if (first) setOrgId(first.id);
      else setNeedsOrg(true);
    });
  }, [session]);

  if (isPending || !session) {
    return <Centered>Loading.</Centered>;
  }

  return (
    <div className="min-h-[100dvh]">
      <TopBar email={session.user.email} />
      <main className="mx-auto max-w-5xl px-6 py-12">
        {needsOrg ? (
          <CreateOrg onCreated={setOrgId} clearNeed={() => setNeedsOrg(false)} />
        ) : orgId ? (
          <OrgView orgId={orgId} />
        ) : (
          <p className="text-ink-soft">Loading your organisation.</p>
        )}
      </main>
    </div>
  );
}

function TopBar({ email }: { email: string }) {
  return (
    <header className="border-b border-rule">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-serif tracking-tight text-ink">
          silent<span className="text-traced">green</span>
        </Link>
        <div className="flex items-center gap-4 text-sm text-ink-soft">
          <span>{email}</span>
          <button onClick={() => signOut().then(() => (location.href = '/'))} className="hover:text-ink">
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[100dvh] items-center justify-center text-ink-soft">{children}</div>;
}

function CreateOrg({ onCreated, clearNeed }: { onCreated: (id: string) => void; clearNeed: () => void }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    setError(null);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
    const { data, error } = await authClient.organization.create({ name, slug });
    setBusy(false);
    if (error || !data) {
      setError(error?.message ?? 'Could not create the organisation.');
      return;
    }
    clearNeed();
    onCreated(data.id);
  }

  return (
    <div className="panel max-w-md rounded-2xl p-7">
      <h1 className="font-serif text-xl text-ink">Name your organisation</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Projects, keys and the evidence ledger belong to an organisation. You can invite people to it later.
      </p>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Fernweh Digital"
        className="mt-5 w-full rounded-lg border border-rule-strong bg-ground-sunken px-3 py-2 text-sm text-ink outline-none focus:border-traced"
      />
      {error && <p className="mt-2 text-sm text-absent">{error}</p>}
      <button
        onClick={create}
        disabled={busy || name.trim().length < 2}
        className="mt-4 rounded-lg bg-traced px-4 py-2 text-sm font-medium text-ground-raised hover:bg-traced disabled:opacity-60"
      >
        {busy ? 'Creating…' : 'Create'}
      </button>
    </div>
  );
}

function OrgView({ orgId }: { orgId: string }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    apiFetch<{ projects: Project[] }>('/v1/projects')
      .then((r) => setProjects(r.projects))
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(load, [load, orgId]);

  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-end justify-between">
          <h1 className="font-serif text-2xl text-ink">Projects</h1>
          <NewProject onCreated={load} />
        </div>
        {error && <p className="mt-3 text-sm text-absent">{error}</p>}
        <div className="mt-6 space-y-4">
          {projects?.length === 0 && (
            <p className="panel-sunken rounded-xl p-5 text-sm text-ink-soft">
              No projects yet. Create one, then push a batch to it.
            </p>
          )}
          {projects?.map((p) => (
            <ProjectCard key={p.id} project={p} orgId={orgId} />
          ))}
        </div>
      </section>
    </div>
  );
}

function NewProject({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await apiFetch('/v1/projects', { method: 'POST', body: JSON.stringify({ name }) });
      setName('');
      setOpen(false);
      onCreated();
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg border border-rule-strong px-3 py-1.5 text-sm text-ink hover:border-traced">
        New project
      </button>
    );

  return (
    <div className="flex gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="support-agent"
        className="rounded-lg border border-rule-strong bg-ground-sunken px-3 py-1.5 text-sm text-ink outline-none focus:border-traced"
      />
      <button onClick={create} disabled={busy} className="rounded-lg bg-traced px-3 py-1.5 text-sm text-ground-raised hover:bg-traced disabled:opacity-60">
        Add
      </button>
    </div>
  );
}

function ProjectCard({ project, orgId }: { project: Project; orgId: string }) {
  const [summary, setSummary] = useState<ProjectSummary | null>(null);
  const [key, setKey] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<ProjectSummary>(`/v1/projects/${project.slug}/summary`).then(setSummary).catch(() => setSummary(null));
  }, [project.slug]);

  async function makeKey() {
    const { data } = await authClient.apiKey.create({
      name: `${project.slug} ingest`,
      prefix: 'sg_',
      metadata: { organizationId: orgId, projectId: project.id },
    });
    if (data?.key) setKey(data.key);
  }

  const t = summary?.totals;

  return (
    <div className="panel rounded-2xl p-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="font-serif text-lg text-ink">{project.name}</h2>
          <code className="font-mono text-xs text-ink-faint">{project.slug}</code>
        </div>
        <button onClick={makeKey} className="rounded-lg border border-rule-strong px-3 py-1.5 text-xs text-ink hover:border-traced">
          New API key
        </button>
      </div>

      {key && (
        <div className="mt-4 rounded-lg border border-traced/50 bg-traced/10 p-3">
          <p className="text-xs text-ink-soft">Copy this now. It is not shown again.</p>
          <code className="mt-1 block break-all font-mono text-xs text-traced">{key}</code>
        </div>
      )}

      <div className="mt-5 grid grid-cols-4 gap-3 text-center">
        <Stat label="tasks" value={t?.tasks ?? 0} tone="text-ink" />
        <Stat label="proven" value={t?.clean ?? 0} tone="text-traced" />
        <Stat label="violated" value={t?.problematic ?? 0} tone="text-absent" />
        <Stat label="unproven" value={t?.inconclusive ?? 0} tone="text-withheld" />
      </div>

      {summary && summary.batches.length > 0 && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-rule">
          {summary.batches.slice(0, 5).map((b) => (
            <li key={b.id}>
              <Link
                href={`/dashboard/batch/${b.id}`}
                className="flex items-center justify-between px-3 py-2 text-xs transition-colors hover:bg-ground-sunken"
              >
                <span className="font-mono text-ink-soft">
                  {new Date(b.uploadedAt).toLocaleDateString()} &middot; {b.taskCount} tasks
                </span>
                <span className="flex gap-2 font-mono">
                  <span className="text-traced">{b.cleanCount}</span>
                  <span className="text-absent">{b.problematic}</span>
                  <span className="text-withheld">{b.inconclusive}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <details className="mt-4">
        <summary className="cursor-pointer text-xs text-ink-soft">Push a batch</summary>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-ground-sunken p-3 font-mono text-xs text-ink-soft">
{`curl -X POST ${process.env.NEXT_PUBLIC_API_URL ?? 'https://api.silentgreen.dev'}/v1/batches \\
  -H "x-api-key: sg_..." \\
  -H "content-type: application/x-ndjson" \\
  --data-binary @tasks.jsonl`}
        </pre>
      </details>
    </div>
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
