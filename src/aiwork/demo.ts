/**
 * A worked example of AI work, so `check` can be run with nothing to set up.
 *
 * This is a support agent answering billing questions with a retrieved invoice
 * in front of it. Twenty tasks. Every one of them would be recorded as a
 * completed task by the pipeline that produced it, and would score well on any
 * evaluation that asks a language model whether the answer looks helpful,
 * because all twenty do look helpful.
 *
 * Five of them are wrong in ways that cost money.
 */

import type { TaskRecord } from './record';

const INVOICE = (n: number, total: string, vat: string, due: string) => `
Invoice INV-2026-${String(400 + n).padStart(4, '0')} for Fernweh Supply Ltd
Issued 2026-08-${String(1 + (n % 20)).padStart(2, '0')}, due ${due}
Billing contact: accounts@fernweh.example
Subtotal ${total}
VAT ${vat}
Portal: https://billing.fernweh.example/inv/2026-${String(400 + n).padStart(4, '0')}
`;

export function demoTasks(): readonly TaskRecord[] {
  const out: TaskRecord[] = [];

  for (let i = 0; i < 20; i++) {
    const total = `£${(500 + i * 13).toFixed(2)}`;
    const vat = `£${((500 + i * 13) * 0.2).toFixed(2)}`;
    const due = `2026-09-${String(1 + (i % 25)).padStart(2, '0')}`;
    const source = INVOICE(i, total, vat, due);
    const id = `task-${String(i + 1).padStart(3, '0')}`;
    const at = new Date(Date.UTC(2026, 8, 1, 9 + (i % 8), 0, 0)).toISOString();
    const input = 'The customer is asking what they owe and when it is due. Answer using the invoice provided.';

    let output: string;

    if (i === 3) {
      // Confidently fabricated: right shape, invented figures and contact.
      output = `Your outstanding balance is £742.60, including VAT of £123.77, and it is due on 2026-09-30. If you need a copy, email finance@fernweh.example.`;
    } else if (i === 7) {
      // The template never rendered, and it went out anyway.
      output = `Hi {{ customer.first_name }}, your balance of {{ invoice.total }} is due on {{ invoice.due_date }}.`;
    } else if (i === 11) {
      // A refusal, carried downstream as though it were an answer.
      output = `I'm sorry, but I cannot access billing information for this account.`;
    } else if (i === 14) {
      // Deferral: scores as a completed task, resolves nothing.
      output = `Thanks for getting in touch. Please contact our support team and they will be able to help you with this.`;
    } else if (i === 16 || i === 17 || i === 18) {
      // The pipeline stopped reading its input three tasks ago.
      output = `Your invoice is available in the billing portal. Please log in to view the current balance and due date.`;
    } else {
      // Correct, and drawn from the source.
      output = `Your subtotal is ${total} with VAT of ${vat}, due on ${due}. The invoice is INV-2026-${String(400 + i).padStart(4, '0')} and you can view it at https://billing.fernweh.example/inv/2026-${String(400 + i).padStart(4, '0')}.`;
    }

    out.push({ id, at, input, sources: [source], output });
  }

  return out;
}
