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
import type { N8nWorkflowDoc } from '../graph/hash';
export type SinkCategory = 'datastore' | 'spreadsheet' | 'messaging' | 'email' | 'crm-or-billing' | 'file-storage' | 'outbound-http' | 'webhook-response' | 'ai-generation' | 'terminal';
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
export declare function findSinks(doc: N8nWorkflowDoc): readonly Sink[];
