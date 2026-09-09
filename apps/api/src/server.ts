/**
 * The API.
 *
 * Two ways in:
 *   - a session cookie, for the dashboard (Better Auth issues it)
 *   - an API key, for a pipeline pushing batches
 *
 * The whole product for a developer is one call: POST /v1/batches with a key.
 */

import { randomUUID } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { toNodeHandler, fromNodeHeaders } from 'better-auth/node';
import { parseTaskRecords } from 'silentgreen';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { auth } from './auth.js';
import { env } from './env.js';
import { db } from './db/index.js';
import { batch, ledgerEntry, member, problem, project, taskResult } from './db/schema.js';
import { ingestBatch } from './ingest.js';

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', env.WEB_ORIGIN);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Vary', 'Origin');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Better Auth owns everything under /api/auth.
app.all('/api/auth/*', toNodeHandler(auth));

app.use('/v1', express.json({ limit: '10mb' }));
app.use('/v1', express.text({ limit: '10mb', type: ['text/plain', 'application/x-ndjson', 'application/jsonl'] }));

/* ------------------------------------------------------------------- auth --- */

interface Principal {
  organizationId: string;
  /** Set when the caller is a project-scoped API key. */
  projectId?: string;
  via: 'session' | 'key';
  label: string;
}

async function activeOrgForUser(userId: string, preferred: string | null): Promise<string | undefined> {
  if (preferred) return preferred;
  const [m] = await db.select({ orgId: member.organizationId }).from(member).where(eq(member.userId, userId)).limit(1);
  return m?.orgId;
}

/** Resolve a session or an API key to one organisation. */
async function authenticate(req: Request): Promise<Principal | { error: string; status: number }> {
  const key = req.header('x-api-key') ?? req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (key && key.startsWith('sg_')) {
    const result = await auth.api.verifyApiKey({ body: { key } });
    if (!result.valid || !result.key) return { error: 'That API key is not valid or has been disabled.', status: 401 };
    const meta = (result.key.metadata ?? {}) as Record<string, unknown>;
    const organizationId = typeof meta.organizationId === 'string' ? meta.organizationId : undefined;
    if (!organizationId) return { error: 'This key is not attached to an organisation. Recreate it.', status: 403 };
    return {
      organizationId,
      projectId: typeof meta.projectId === 'string' ? meta.projectId : undefined,
      via: 'key',
      label: `key:${result.key.id}`,
    };
  }

  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session?.user) return { error: 'Sign in, or provide an API key.', status: 401 };
  const orgId = await activeOrgForUser(session.user.id, session.session.activeOrganizationId ?? null);
  if (!orgId) return { error: 'This account is not in an organisation yet. Create one first.', status: 409 };
  return { organizationId: orgId, via: 'session', label: `user:${session.user.id}` };
}

function guard(handler: (req: Request, res: Response, who: Principal) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const who = await authenticate(req);
      if ('error' in who) {
        res.status(who.status).json({ error: who.error });
        return;
      }
      await handler(req, res, who);
    } catch (err) {
      next(err);
    }
  };
}

async function resolveProject(orgId: string, ref: string | undefined): Promise<string | undefined> {
  if (!ref) return undefined;
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.organizationId, orgId), ref.includes('-') && ref.length === 36 ? eq(project.id, ref) : eq(project.slug, ref)))
    .limit(1);
  return row?.id;
}

/* --------------------------------------------------------------- projects --- */

app.get(
  '/v1/projects',
  guard(async (_req, res, who) => {
    const rows = await db.select().from(project).where(eq(project.organizationId, who.organizationId)).orderBy(project.createdAt);
    res.json({ projects: rows });
  }),
);

app.post(
  '/v1/projects',
  guard(async (req, res, who) => {
    if (who.via !== 'session') {
      res.status(403).json({ error: 'Projects are created from the dashboard.' });
      return;
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2) {
      res.status(422).json({ error: 'Give the project a name.' });
      return;
    }
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'project';
    const id = randomUUID();
    try {
      await db.insert(project).values({ id, organizationId: who.organizationId, name, slug });
    } catch {
      res.status(409).json({ error: `A project with the slug "${slug}" already exists in this organisation.` });
      return;
    }
    res.status(201).json({ project: { id, organizationId: who.organizationId, name, slug } });
  }),
);

/* ---------------------------------------------------------------- batches --- */

app.post(
  '/v1/batches',
  guard(async (req, res, who) => {
    if (who.via !== 'key') {
      res.status(403).json({ error: 'Batches are pushed with an API key, not a session.' });
      return;
    }

    let text: string;
    let projectRef: string | undefined;
    let source: string | undefined;

    if (typeof req.body === 'string') {
      text = req.body;
    } else if (req.body && typeof req.body === 'object') {
      projectRef = typeof req.body.project === 'string' ? req.body.project : undefined;
      source = typeof req.body.source === 'string' ? req.body.source : undefined;
      text = Array.isArray(req.body.tasks) ? JSON.stringify(req.body.tasks) : '';
    } else {
      res.status(400).json({ error: 'Send JSONL text, or a JSON object with a "tasks" array.' });
      return;
    }

    const projectId = (await resolveProject(who.organizationId, projectRef)) ?? who.projectId;
    if (!projectId) {
      res.status(400).json({ error: 'No project resolved. Pass "project" (slug) in the body, or use a project-scoped key.' });
      return;
    }

    const parsed = parseTaskRecords(text);
    if (parsed.records.length === 0) {
      res.status(422).json({ error: 'No readable tasks in the payload.', issues: parsed.issues.slice(0, 10) });
      return;
    }

    const result = await ingestBatch({
      projectId,
      records: parsed.records,
      ...(source ? { source } : {}),
      uploadedBy: who.label,
      unreadableLines: parsed.issues.length,
    });

    res.status(201).json({ ...result, unreadableLines: parsed.issues.length, issues: parsed.issues.slice(0, 10) });
  }),
);

app.get(
  '/v1/projects/:id/summary',
  guard(async (req, res, who) => {
    const projectId = await resolveProject(who.organizationId, req.params.id);
    if (!projectId) {
      res.status(404).json({ error: 'Project not found in this organisation.' });
      return;
    }
    const batches = await db.select().from(batch).where(eq(batch.projectId, projectId)).orderBy(desc(batch.uploadedAt));
    const totals = batches.reduce(
      (a, b) => ({
        tasks: a.tasks + b.taskCount,
        clean: a.clean + b.cleanCount,
        problematic: a.problematic + b.problematic,
        inconclusive: a.inconclusive + b.inconclusive,
      }),
      { tasks: 0, clean: 0, problematic: 0, inconclusive: 0 },
    );
    const [head] = await db
      .select({ seq: ledgerEntry.seq, hash: ledgerEntry.hash })
      .from(ledgerEntry)
      .where(eq(ledgerEntry.projectId, projectId))
      .orderBy(desc(ledgerEntry.seq))
      .limit(1);
    res.json({ projectId, totals, batches });
    void head;
  }),
);

app.get(
  '/v1/batches/:id',
  guard(async (req, res, who) => {
    const [b] = await db
      .select()
      .from(batch)
      .where(eq(batch.id, req.params.id ?? ''))
      .limit(1);
    if (!b || !(await resolveProject(who.organizationId, b.projectId))) {
      res.status(404).json({ error: 'Batch not found.' });
      return;
    }
    const tasks = await db.select().from(taskResult).where(eq(taskResult.batchId, b.id));
    const ids = tasks.map((t) => t.id);
    const problems = ids.length > 0 ? await db.select().from(problem).where(inArray(problem.taskResultId, ids)) : [];
    const byTask = new Map(tasks.map((t) => [t.id, [] as typeof problems]));
    for (const p of problems) byTask.get(p.taskResultId)?.push(p);
    res.json({ batch: b, tasks: tasks.map((t) => ({ ...t, problems: byTask.get(t.id) ?? [] })) });
  }),
);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

app.listen(env.PORT, () => {
  console.log(`silentgreen api on :${env.PORT}  (auth at ${env.BETTER_AUTH_URL}/api/auth)`);
});
