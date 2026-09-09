'use client';

/** The API base. Same-origin in dev via a rewrite is not set up for /v1, so use the env directly. */
const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
}

export interface BatchRow {
  id: string;
  source: string | null;
  taskCount: number;
  cleanCount: number;
  problematic: number;
  inconclusive: number;
  uploadedAt: string;
}

export interface ProjectSummary {
  projectId: string;
  totals: { tasks: number; clean: number; problematic: number; inconclusive: number };
  batches: BatchRow[];
}

export interface ProblemRow {
  id: string;
  kind: string;
  summary: string;
  evidenceRedacted: string;
}

export interface TaskResultRow {
  id: string;
  taskId: string;
  verdict: 'clean' | 'problem' | 'inconclusive';
  atomsChecked: number;
  inconclusiveReason: string | null;
  at: string | null;
  problems: ProblemRow[];
}

export interface BatchDetail {
  batch: BatchRow & { projectId: string; unreadableLines: number };
  tasks: TaskResultRow[];
}
