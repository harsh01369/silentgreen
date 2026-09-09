/**
 * The database schema.
 *
 * Better Auth's own tables live in `auth-schema.generated.ts`, produced by
 * `npx @better-auth/cli generate` and committed. Regenerate it on every
 * Better Auth upgrade rather than hand-editing.
 *
 * This file re-exports those and adds the application's own tables: projects,
 * the batches uploaded to them, the per-task verdicts, and the hash-chained
 * ledger, one chain per project.
 */

import { relations } from 'drizzle-orm';
import { integer, jsonb, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

export * from './auth-schema.generated.js';
import { organization } from './auth-schema.generated.js';

/* -------------------------------------------------------------- application */

export const project = pgTable(
  'project',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [unique('project_org_slug_uq').on(t.organizationId, t.slug)],
);

/** One upload: a set of task records checked together. */
export const batch = pgTable('batch', {
  id: text('id').primaryKey(),
  projectId: text('project_id')
    .notNull()
    .references(() => project.id, { onDelete: 'cascade' }),
  source: text('source'),
  taskCount: integer('task_count').notNull(),
  cleanCount: integer('clean_count').notNull(),
  problematic: integer('problematic').notNull(),
  inconclusive: integer('inconclusive').notNull(),
  unreadableLines: integer('unreadable_lines').notNull().default(0),
  uploadedBy: text('uploaded_by'),
  uploadedAt: timestamp('uploaded_at').notNull().defaultNow(),
});

export const taskResult = pgTable('task_result', {
  id: text('id').primaryKey(),
  batchId: text('batch_id')
    .notNull()
    .references(() => batch.id, { onDelete: 'cascade' }),
  taskId: text('task_id').notNull(),
  verdict: text('verdict').notNull(), // clean | problem | inconclusive
  atomsChecked: integer('atoms_checked').notNull().default(0),
  inconclusiveReason: text('inconclusive_reason'),
  at: timestamp('at'),
});

/**
 * A single finding. `evidenceRedacted` keeps the kind and a shape hint, never
 * the personal value, on the free tier. Full evidence, encrypted, is a
 * paid-tier column added later.
 */
export const problem = pgTable('problem', {
  id: text('id').primaryKey(),
  taskResultId: text('task_result_id')
    .notNull()
    .references(() => taskResult.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  summary: text('summary').notNull(),
  evidenceRedacted: text('evidence_redacted').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/** The hash chain, one per project. Append only. */
export const ledgerEntry = pgTable(
  'ledger_entry',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    hash: text('hash').notNull(),
    prevHash: text('prev_hash'),
    payload: jsonb('payload').notNull(),
    at: timestamp('at').notNull().defaultNow(),
  },
  (t) => [unique('ledger_project_seq_uq').on(t.projectId, t.seq)],
);

/* ------------------------------------------------------------------ relations */

export const projectRelations = relations(project, ({ one, many }) => ({
  organization: one(organization, { fields: [project.organizationId], references: [organization.id] }),
  batches: many(batch),
  ledger: many(ledgerEntry),
}));

export const batchRelations = relations(batch, ({ one, many }) => ({
  project: one(project, { fields: [batch.projectId], references: [project.id] }),
  tasks: many(taskResult),
}));

export const taskResultRelations = relations(taskResult, ({ one, many }) => ({
  batch: one(batch, { fields: [taskResult.batchId], references: [batch.id] }),
  problems: many(problem),
}));
