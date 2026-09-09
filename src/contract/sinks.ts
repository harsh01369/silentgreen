/**
 * Finding the steps whose output the business actually cares about.
 *
 * A workflow of thirty nodes does not need thirty contracts. It needs contracts
 * where work leaves the system: the row appended, the invoice posted, the email
 * sent, the response returned. Those are the points where "the run went green
 * but nothing happened" becomes a real consequence for a real person.
 *
 * Two signals identify them. The first is the node type: a Google Sheets append
 * or a Postgres insert is a side effect by definition. The second is position:
 * a node with nothing downstream is where a branch's work ends, whatever it is.
 *
 * We rank rather than filter, because being wrong here should cost attention
 * rather than coverage. A misranked sink shows up lower in a review queue. A
 * missed sink is a blind spot nobody knows they have.
 */

import type { N8nWorkflowDoc, N8nNode } from '../graph/hash';
import { canonicalise } from '../graph/hash';

export type SinkCategory =
  | 'datastore'
  | 'spreadsheet'
  | 'messaging'
  | 'email'
  | 'crm-or-billing'
  | 'file-storage'
  | 'outbound-http'
  | 'webhook-response'
  | 'ai-generation'
  | 'terminal';

export interface Sink {
  readonly nodeId: string;
  readonly nodeName: string;
  readonly nodeType: string;
  readonly category: SinkCategory;
  /** 0 to 100. Higher means more likely to be worth a contract. */
  readonly importance: number;
  /** Why we picked it, in language a person reviewing the queue can act on. */
  readonly rationale: string;
  /** True when nothing downstream consumes this node's output. */
  readonly terminal: boolean;
}

/** Node types that write to the world. Grouped so rationales can be specific. */
const CATEGORIES: ReadonlyArray<{ readonly category: SinkCategory; readonly match: RegExp; readonly weight: number }> = [
  { category: 'datastore', match: /\.(postgres|mySql|mongoDb|redis|supabase|snowflake|questDb|timescaleDb|crateDb|elasticsearch)$/i, weight: 95 },
  { category: 'spreadsheet', match: /\.(googleSheets|microsoftExcel|airtable|nocoDb|baserow|notion|coda)$/i, weight: 92 },
  { category: 'crm-or-billing', match: /\.(hubspot|salesforce|pipedrive|zohoCrm|stripe|shopify|quickbooks|xero|chargebee|freshworksCrm|copper)$/i, weight: 94 },
  { category: 'email', match: /\.(gmail|emailSend|sendGrid|mailgun|microsoftOutlook|sendInBlue|brevo)$/i, weight: 88 },
  { category: 'messaging', match: /\.(slack|telegram|discord|twilio|whatsApp|microsoftTeams|pushover|mattermost)$/i, weight: 82 },
  { category: 'file-storage', match: /\.(awsS3|googleDrive|dropbox|ftp|sftp|box|oneDrive)$/i, weight: 80 },
  { category: 'webhook-response', match: /\.respondToWebhook$/i, weight: 90 },
  { category: 'ai-generation', match: /\.(openAi|anthropic|lmChat|chainLlm|agent|informationExtractor|textClassifier)/i, weight: 70 },
];

function categorise(type: string): { category: SinkCategory; weight: number } | undefined {
  for (const c of CATEGORIES) {
    if (c.match.test(type)) return { category: c.category, weight: c.weight };
  }
  return undefined;
}

/**
 * An HTTP Request is a sink only when it changes something. A GET that fetches
 * data is a source, and putting a contract on it produces noise rather than
 * safety.
 */
function httpIsWrite(node: N8nNode): boolean {
  const method = String((node.parameters as Record<string, unknown> | undefined)?.['method'] ?? 'GET').toUpperCase();
  return method !== 'GET' && method !== 'HEAD';
}

function describe(category: SinkCategory, name: string, terminal: boolean): string {
  const tail = terminal ? ' Nothing downstream consumes it, so if it produces nothing the run still ends green.' : '';
  switch (category) {
    case 'datastore':
      return `"${name}" writes to a database, so an empty run here is data that quietly never arrived.${tail}`;
    case 'spreadsheet':
      return `"${name}" writes rows a person will later read as fact.${tail}`;
    case 'crm-or-billing':
      return `"${name}" touches records with money or customers attached, where a silent miss is expensive.${tail}`;
    case 'email':
      return `"${name}" sends email. An empty or half-rendered send reaches a real inbox and cannot be recalled.${tail}`;
    case 'messaging':
      return `"${name}" posts a message someone is expected to act on.${tail}`;
    case 'file-storage':
      return `"${name}" writes files that other systems or people pick up later.${tail}`;
    case 'outbound-http':
      return `"${name}" sends a request that changes something in another system, so a run that reaches it and posts nothing leaves the two systems disagreeing.${tail}`;
    case 'webhook-response':
      return `"${name}" is what the caller receives. If it is empty the caller sees a successful, useless response.${tail}`;
    case 'ai-generation':
      return `"${name}" generates content with a model, which can decline or return something shaped correctly and substantively wrong.${tail}`;
    case 'terminal':
      return `"${name}" is where this branch ends. Whatever it produces is the run's result.${tail}`;
  }
}

export function findSinks(doc: N8nWorkflowDoc): readonly Sink[] {
  const canonical = canonicalise(doc);
  const outgoing = new Set(canonical.edges.map((e) => e.from));
  const byId = new Map<string, N8nNode>();
  for (const n of doc.nodes ?? []) {
    byId.set(n.id && n.id.trim() ? n.id : `name:${n.name}`, n);
  }

  const sinks: Sink[] = [];
  for (const [nodeId, node] of byId) {
    if (node.disabled === true) continue;
    // A trigger is where work enters, never where it leaves.
    if (/trigger$/i.test(node.type) || /\.webhook$/i.test(node.type)) continue;

    const terminal = !outgoing.has(nodeId);
    const cat = categorise(node.type);

    let category: SinkCategory | undefined;
    let weight = 0;

    if (cat) {
      category = cat.category;
      weight = cat.weight;
    } else if (/\.httpRequest$/i.test(node.type)) {
      if (httpIsWrite(node)) {
        category = 'outbound-http';
        weight = 86;
      } else if (terminal) {
        // A terminal GET is unusual and usually means the fetched data is the
        // point, so it is still worth offering.
        category = 'terminal';
        weight = 55;
      }
    } else if (terminal && !/\.(noOp|stickyNote|set|code|if|switch|merge|splitInBatches|filter)$/i.test(node.type)) {
      category = 'terminal';
      weight = 60;
    }

    if (!category) continue;

    // Ending a branch raises the stakes: there is nothing after it to notice.
    const importance = Math.min(100, weight + (terminal ? 8 : 0));

    sinks.push({
      nodeId,
      nodeName: node.name,
      nodeType: node.type,
      category,
      importance,
      rationale: describe(category, node.name, terminal),
      terminal,
    });
  }

  return sinks.sort((a, b) => b.importance - a.importance || a.nodeName.localeCompare(b.nodeName));
}
