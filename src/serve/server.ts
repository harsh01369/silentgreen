/**
 * The review interface.
 *
 * The confirmation gate is the whole argument of this product, and until now it
 * existed only as a function nobody could reach. This is where a person sees
 * what an expectation will actually be judging, and takes responsibility for it
 * by name.
 *
 * It runs locally, binds to 127.0.0.1 by default and has no accounts, because
 * it reads a store on your own disk and there is nothing here worth putting
 * behind a login that a filesystem permission would not do better.
 *
 * The browser never reimplements the gate. Every confirmation is decided by the
 * same `confirmAssertion` the CLI uses, and the live feedback on the attestation
 * box calls the real function over HTTP rather than a copy of its rules in
 * JavaScript. One source of truth, or the gate is theatre.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Store } from '../store/store';
import { isSubstantiveAttestation, coverageHonesty, confirmationRequirements } from '../contract/circularity';
import { APP_HTML } from './app';
import type { Assertion } from '../contract/types';

interface Body {
  [k: string]: unknown;
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<Body> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A local tool still should not accept an unbounded body.
    if (size > 1_000_000) throw new Error('Request body too large.');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Body;
  } catch {
    throw new Error('Request body was not valid JSON.');
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Everything the review screen needs, shaped for display rather than for storage. */
function stateFor(store: Store) {
  const workflows = store.workflows().map((wf) => {
    const list = store.assertions(wf.id);
    const honesty = coverageHonesty(list);
    return {
      id: wf.id,
      name: wf.name,
      platform: wf.platform,
      active: wf.active,
      hash: wf.hash,
      shortHash: wf.hash.slice(0, 10),
      clientId: wf.clientId,
      lastScannedAt: wf.lastScannedAt,
      counts: store.counts(wf.id),
      honesty,
      sampleRunIds: wf.sampleRunIds,
      observedWindow: wf.observedWindow,
      sinkNames: sinkNames(wf.doc),
      // Only the samples a reviewer might need, trimmed for transport.
      samples: Object.fromEntries(
        Object.entries(wf.samples).map(([k, v]) => [k, v.slice(0, 3)]),
      ),
      staleChanges:
        wf.previousDoc && wf.previousHash !== wf.hash
          ? { fromHash: wf.previousHash?.slice(0, 10) ?? '' }
          : undefined,
    };
  });

  const assertions = store.assertions().map((a) => {
    const extended = a as Assertion & { rationale?: string; confidence?: string };
    const req = confirmationRequirements(a.basis);
    return {
      id: a.id,
      workflowId: a.workflowId,
      sinkId: a.sinkId,
      kind: a.kind,
      basis: a.basis,
      statement: a.statement,
      params: a.params,
      status: a.status,
      rationale: extended.rationale ?? '',
      confidence: extended.confidence ?? 'moderate',
      needsAttestation: req.needsBaselineAttestation,
      proves: req.proves,
      doesNotProve: req.doesNotProve,
      confirmation: a.confirmation
        ? {
            by: a.confirmation.by,
            at: a.confirmation.at,
            attestation: a.confirmation.baselineAttestation?.howKnown,
          }
        : undefined,
      stale: a.stale,
      createdAt: a.createdAt,
    };
  });

  return {
    workflows,
    assertions,
    clients: store.clients(),
    ledgerLength: store.ledger.length,
    ledgerOk: store.ledger.verify().ok,
  };
}

function sinkNames(doc: { nodes?: readonly { id?: string; name: string }[] }): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of doc.nodes ?? []) out[n.id && n.id.trim() ? n.id : `name:${n.name}`] = n.name;
  out['*'] = 'the workflow as a whole';
  return out;
}

export interface ServeOptions {
  readonly port?: number;
  readonly host?: string;
  readonly storeDir?: string;
}

export function serve(opts: ServeOptions = {}): Promise<{ url: string; close: () => void }> {
  const port = opts.port ?? 4666;
  const host = opts.host ?? '127.0.0.1';

  const server = createServer((req, res) => {
    void handle(req, res, opts.storeDir).catch((err: unknown) => {
      json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      resolve({ url: `http://${host}:${port}/`, close: () => server.close() });
    });
  });
}

async function handle(req: IncomingMessage, res: ServerResponse, storeDir?: string): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(APP_HTML);
    return;
  }

  // The store is re-read per request. It is a small file, and it means an edit
  // made by a `scan` running in another terminal shows up without a restart.
  const store = new Store(storeDir);

  if (req.method === 'GET' && path === '/api/state') {
    json(res, 200, stateFor(store));
    return;
  }

  if (req.method === 'POST' && path === '/api/attestation-check') {
    const body = await readBody(req);
    const text = str(body.howKnown);
    // Deliberately the same function the gate uses. If these ever diverge, the
    // interface starts promising something the gate will refuse.
    json(res, 200, {
      substantive: isSubstantiveAttestation(text),
      hint:
        'Name what you checked it against. "Reconciled against the client invoice export for August" is an attestation. "Looks fine" is not, and this sentence is printed in the report beside every result it produces.',
    });
    return;
  }

  if (req.method === 'POST' && path === '/api/confirm') {
    const body = await readBody(req);
    const assertionId = str(body.assertionId);
    const by = str(body.by);
    const a = store.assertion(assertionId);
    if (!a) {
      json(res, 404, { error: 'No such expectation.' });
      return;
    }
    const wf = store.workflow(a.workflowId);
    if (!wf) {
      json(res, 404, { error: 'That expectation belongs to a workflow that is no longer in the store.' });
      return;
    }

    const att = body.attestation as { windowStart?: string; windowEnd?: string; howKnown?: string } | undefined;
    const result = store.confirm(assertionId, {
      by,
      at: new Date().toISOString(),
      workflowHash: wf.hash,
      evidenceRunIds: wf.sampleRunIds,
      ...(att && att.howKnown
        ? {
            baselineAttestation: {
              windowStart: str(att.windowStart),
              windowEnd: str(att.windowEnd),
              howKnown: str(att.howKnown),
            },
          }
        : {}),
    });

    if (!result.ok) {
      store.save();
      json(res, 200, { ok: false, refusal: result.refusal });
      return;
    }
    store.save();
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && path === '/api/retire') {
    const body = await readBody(req);
    const ok = store.retire(str(body.assertionId), str(body.by), str(body.why));
    store.save();
    json(res, ok ? 200 : 404, { ok });
    return;
  }

  if (req.method === 'POST' && path === '/api/client') {
    const body = await readBody(req);
    store.setClient(str(body.workflowId), str(body.clientId), str(body.clientName));
    store.save();
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && path === '/api/ledger') {
    const wfId = url.searchParams.get('workflow');
    const entries = wfId ? store.ledger.forWorkflow(wfId) : store.ledger.all();
    json(res, 200, { entries: entries.slice(-200), verify: store.ledger.verify() });
    return;
  }

  json(res, 404, { error: 'Not found.' });
}
