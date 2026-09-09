/**
 * The API.
 *
 * Two ways in:
 *   - a session cookie, for the dashboard (Better Auth handles it)
 *   - an API key, for a pipeline pushing batches
 *
 * The whole product for a developer is one call: POST /v1/batches with a key.
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { toNodeHandler } from 'better-auth/node';
import { parseTaskRecords } from 'silentgreen';
import { and, eq, inArray } from 'drizzle-orm';
import { auth } from './auth.js';
import { env } from './env.js';
import { db } from './db/index.js';
import { batch, ledgerEntry, problem, project, taskResult } from './db/schema.js';
import { ingestBatch } from './ingest.js';

const app = express();
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', env.WEB_ORIGIN);
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true }));

// Better Auth owns everything under /api/auth.
app.all('/api/auth/*', toNodeHandler(auth));

// JSON body for our own routes. The ingest route also accepts raw text.
app.use('/v1', express.json({ limit: '10mb' }));
app.use('/v1', express.text({ limit: '10mb', type: ['text/plain', 'application/x-ndjson', 'application/jsonl'] }));

interface KeyContext {
  organizationId: string;
  projectId?: string;
  keyId: string;
}

async function requireApiKey(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = req.header('x-api-key') ?? req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!raw) {
    res.status(401).json({ error: 'Provide an API key in x-api-key or Authorization: Bearer.' });
    return;
  }
  const result = await auth.api.verifyApiKey({ body: { key: raw } });
  if (!result.valid || !result.key) {
    res.status(401).json({ error: 'That API key is not valid or has been disabled.' });
    return;
  }
  const meta = (result.key.metadata ?? {}) as Record<string, unknown>;
  const organizationId = typeof meta.organizationId === 'string' ? meta.organizationId : undefined;
  if (!organizationId) {
    res.status(403).json({ error: 'This key is not attached to an organisation. Recreate it from the dashboard.' });
    return;
  }
  (req as Request & { key: KeyContext }).key = {
    organizationId,
    projectId: typeof meta.projectId === 'string' ? meta.projectId : undefined,
    keyId: result.key.id,
  };
  next();
}

async function resolveProject(organizationId: string, ref: string | undefined, fallbackId: string | undefined): Promise<string | undefined> {
  const id = ref ?? fallbackId;
  if (!id) return undefined;
  const [row] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.organizationId, organizationId), ref ? eq(project.slug, ref) : eq(project.id, id)))
    .limit(1);
  return row?.id;
}

/**
 * POST /v1/batches
 * Body: JSONL/JSON text, or { project?, source?, tasks: [...] }.
 */
app.post('/v1/batches', requireApiKey, async (req: Request, res: Response) => {
  const key = (req as Request & { key: KeyContext }).key;

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

  const projectId = await resolveProject(key.organizationId, projectRef, key.projectId);
  if (!projectId) {
    res.status(400).json({ error: 'No project resolved. Pass "project" (slug) in the body, or use a project-scoped key.' });
    return;
  }

  const parsed = parseTaskRecords(text);
  if (parsed.records.length === 0) {
    res.status(422).json({
      error: 'No readable tasks in the payload.',
      issues: parsed.issues.slice(0, 10),
    });
    return;
  }

  const result = await ingestBatch({
    projectId,
    records: parsed.records,
    source,
    uploadedBy: `key:${key.keyId}`,
    unreadableLines: parsed.issues.length,
  });

  res.status(201).json({
    ...result,
    unreadableLines: parsed.issues.length,
    issues: parsed.issues.slice(0, 10),
  });
});

/** GET /v1/projects/:id/summary  (API key) */
app.get('/v1/projects/:id/summary', requireApiKey, async (req: Request, res: Response) => {
  const key = (req as Request & { key: KeyContext }).key;
  const projectId = await resolveProject(key.organizationId, undefined, req.params.id ?? '');
  if (!projectId) {
    res.status(404).json({ error: 'Project not found in this organisation.' });
    return;
  }
  const batches = await db.select().from(batch).where(eq(batch.projectId, projectId)).orderBy(batch.uploadedAt);
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
    .orderBy(ledgerEntry.seq)
    .limit(1);
  res.json({ projectId, totals, batches: batches.length, ledgerHead: head ?? null });
});

/** GET /v1/batches/:id  (API key) */
app.get('/v1/batches/:id', requireApiKey, async (req: Request, res: Response) => {
  const key = (req as Request & { key: KeyContext }).key;
  const [b] = await db.select().from(batch).where(eq(batch.id, req.params.id ?? '')).limit(1);
  if (!b) {
    res.status(404).json({ error: 'Batch not found.' });
    return;
  }
  const owned = await resolveProject(key.organizationId, undefined, b.projectId);
  if (!owned) {
    res.status(404).json({ error: 'Batch not found.' });
    return;
  }
  const tasks = await db.select().from(taskResult).where(eq(taskResult.batchId, b.id));
  const taskIds = tasks.map((t) => t.id);
  const problems = taskIds.length > 0 ? await db.select().from(problem).where(inArray(problem.taskResultId, taskIds)) : [];
  const byTask = new Map(tasks.map((t) => [t.id, [] as typeof problems]));
  for (const p of problems) byTask.get(p.taskResultId)?.push(p);
  res.json({
    batch: b,
    tasks: tasks.map((t) => ({ ...t, problems: byTask.get(t.id) ?? [] })),
  });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side.' });
});

app.listen(env.PORT, () => {
  console.log(`silentgreen api on :${env.PORT}  (auth at ${env.BETTER_AUTH_URL}/api/auth)`);
});
