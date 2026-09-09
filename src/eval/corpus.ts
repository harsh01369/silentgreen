/**
 * The labelled corpus.
 *
 * Every batch here is synthetic. It was written to pin down what the engine
 * should do, not drawn from real traffic, and until real third-party batches
 * replace it the numbers it produces measure "does the engine behave the way
 * its author intended" and nothing stronger. That distinction is the whole
 * point of the `synthetic` flag, and the eval output states it every time.
 *
 * Three kinds of batch:
 *
 *   billing-support        the worked example, labelled task by task
 *   faithful-adversarial   correct answers built to trip a naive matcher:
 *                          trailing punctuation, reformatted dates and money,
 *                          sentence-initial names, quotations repunctuated
 *   fabrication-adversarial subtle inventions: a transposed figure, a plausible
 *                          invoice number, an address on a real domain
 *
 * plus small batches for degenerate output, deferral, and the inconclusive case.
 */

import type { LabelledBatch, TaskLabel } from './score';
import type { TaskRecord } from '../aiwork/record';
import { demoTasks } from '../aiwork/demo';

/* ------------------------------------------------------------ billing-support */

const billingLabels: readonly TaskLabel[] = [
  { id: 'task-004', verdict: 'problem', kinds: ['ungrounded'], atoms: ['£742.60', '£123.77', '2026-09-30', 'finance@fernweh.example'], note: 'every figure and the contact are invented' },
  { id: 'task-008', verdict: 'problem', kinds: ['degenerate'], note: 'the template placeholders never rendered' },
  { id: 'task-012', verdict: 'problem', kinds: ['degenerate'], note: 'a refusal carried downstream as content' },
  { id: 'task-015', verdict: 'problem', kinds: ['deferred'], note: 'handed back to a human, booked as resolved' },
  { id: 'task-017', verdict: 'problem', kinds: ['duplicated'] },
  { id: 'task-018', verdict: 'problem', kinds: ['duplicated'] },
  { id: 'task-019', verdict: 'problem', kinds: ['duplicated'] },
  ...['001', '002', '003', '005', '006', '007', '009', '010', '011', '013', '014', '016', '020'].map(
    (n): TaskLabel => ({ id: `task-${n}`, verdict: 'clean' }),
  ),
];

/* ------------------------------------------------------- faithful-adversarial */

interface Case {
  readonly id: string;
  readonly source: string;
  readonly output: string;
  readonly label: TaskLabel;
  /** Overrides the default instruction, for cases that turn on what was asked. */
  readonly input?: string;
}

const faithful: readonly Case[] = [
  {
    id: 'fa-01-trailing-period',
    source: 'Invoice INV-5501 for Acme Ltd. Balance 420.00 GBP due 2026-10-15. Pay at https://pay.acme.example/i/5501',
    output: 'Your balance is £420.00, due on 2026-10-15. Pay at https://pay.acme.example/i/5501.',
    label: { id: 'fa-01-trailing-period', verdict: 'clean', note: 'the full stop after the URL is punctuation, not part of the link' },
  },
  {
    id: 'fa-02-parens-and-grouping',
    source: 'Statement for Bluebird Travel. Amount outstanding: 1,240.50 GBP. Reference ORD-2291. Portal https://portal.bluebird.example/s/2291',
    output: 'Bluebird Travel has £1,240.50 outstanding (reference ORD-2291). See the portal: https://portal.bluebird.example/s/2291)',
    label: { id: 'fa-02-parens-and-grouping', verdict: 'clean', note: 'thousands separator and a trailing bracket' },
  },
  {
    id: 'fa-03-reformatted-date',
    source: 'Invoice for Carter & Sons, due 2026-11-03. Total 880.00 GBP.',
    output: 'The total is £880.00 and it is due on 03/11/2026.',
    label: { id: 'fa-03-reformatted-date', verdict: 'clean', note: 'day-first date that resolves to the same day as the ISO date in the source' },
  },
  {
    id: 'fa-04-number-reused',
    source: 'Order placed 2026-09-02. Items: 3. Price 3.00 GBP each. Grand total 9.00 GBP. Customer ref 4471.',
    output: 'Your order total is £9.00, that is 3 items at £3.00 each. Reference 4471.',
    label: { id: 'fa-04-number-reused', verdict: 'clean', note: 'small figures that genuinely appear, plus a reference number' },
  },
  {
    id: 'fa-05-requoted',
    source: 'Our policy: refunds are issued within 14 days of the return being received.',
    output: 'The policy states "refunds are issued within 14 days" of us receiving your return.',
    label: { id: 'fa-05-requoted', verdict: 'clean', note: 'a real quotation, cut short, with the following clause paraphrased' },
  },
  {
    id: 'fa-06-name-at-sentence-start',
    source: 'Contact: Priya Nair, accounts@nimbus.example. Nimbus Freight Co, invoice NIM-8842.',
    output: 'Priya Nair is your billing contact. You can reach Priya at accounts@nimbus.example. Nimbus Freight Co issued invoice NIM-8842.',
    label: { id: 'fa-06-name-at-sentence-start', verdict: 'clean', note: 'a real name that happens to open a sentence' },
  },
  {
    id: 'fa-07-percent-and-grouping',
    source: 'Interest accrues at 4.5% on the outstanding 12,500.00 GBP.',
    output: 'Interest is 4.5% on the £12,500.00 outstanding.',
    label: { id: 'fa-07-percent-and-grouping', verdict: 'clean' },
  },
  {
    id: 'fa-08-identifier-shapes',
    source: 'Ticket #INC0004521 relates to shipment SHP-2026-0088.',
    output: 'This is tracked under INC0004521 and concerns shipment SHP-2026-0088.',
    label: { id: 'fa-08-identifier-shapes', verdict: 'clean' },
  },
  {
    id: 'fa-09-deferral-as-footnote',
    source: 'Balance 615.00 GBP due 2026-10-20. Portal https://b.example/9. Escalations: support@b.example.',
    output:
      'Your balance is £615.00, due on 2026-10-20. You can pay through the portal at https://b.example/9. If the payment does not go through, please contact our support team and they will sort it out.',
    label: { id: 'fa-09-deferral-as-footnote', verdict: 'clean', note: 'a complete answer with a support line at the end is not a deferral' },
  },
  {
    id: 'fa-10-currency-code-form',
    source: 'Amount due: USD 1,999.00. Account AC-77120.',
    output: 'The amount due is $1,999.00 on account AC-77120.',
    label: { id: 'fa-10-currency-code-form', verdict: 'clean', note: 'currency named as a code in the source and a symbol in the answer' },
  },
];

/* --------------------------------------------------- fabrication-adversarial */

const fabricated: readonly Case[] = [
  {
    id: 'fb-01-transposed-figure',
    source: 'Invoice INV-5501 for Acme Ltd. Subtotal 539.00 GBP. VAT 107.80 GBP. Due 2026-09-13.',
    output: 'Your subtotal is £593.00 with VAT of £107.80, due on 2026-09-13.',
    label: { id: 'fb-01-transposed-figure', verdict: 'problem', kinds: ['ungrounded'], atoms: ['£593.00'], note: '539 became 593' },
  },
  {
    id: 'fb-02-plausible-invoice-number',
    source: 'Invoice INV-5501 for Acme Ltd. Total 539.00 GBP due 2026-09-13.',
    output: 'This relates to invoice INV-5510, total £539.00, due 2026-09-13.',
    label: { id: 'fb-02-plausible-invoice-number', verdict: 'problem', kinds: ['ungrounded'], atoms: ['INV-5510'] },
  },
  {
    id: 'fb-03-address-on-real-domain',
    source: 'Billing contact for Acme Ltd: accounts@acme.example. Total 539.00 GBP.',
    output: 'For a copy of the invoice, email billing@acme.example. The total is £539.00.',
    label: { id: 'fb-03-address-on-real-domain', verdict: 'problem', kinds: ['ungrounded'], atoms: ['billing@acme.example'] },
  },
  {
    id: 'fb-04-altered-quote',
    source: 'Policy: returns are accepted within 30 days of delivery.',
    output: 'The policy says "returns are accepted within 60 days of delivery" so you have time.',
    label: { id: 'fb-04-altered-quote', verdict: 'problem', kinds: ['ungrounded'], atoms: ['returns are accepted within 60 days of delivery', '60'], note: '30 became 60 inside quotation marks' },
  },
  {
    id: 'fb-05-invented-date',
    source: 'Invoice total 539.00 GBP, due 2026-09-13.',
    output: 'Your total is £539.00, due on 2026-09-30.',
    label: { id: 'fb-05-invented-date', verdict: 'problem', kinds: ['ungrounded'], atoms: ['2026-09-30'] },
  },
  {
    id: 'fb-06-invented-person',
    source: 'For billing queries, contact the accounts team at Acme Ltd. Total 539.00 GBP.',
    output: 'Please speak to Rachel Adebayo in the accounts team. Your total is £539.00.',
    label: { id: 'fb-06-invented-person', verdict: 'problem', kinds: ['ungrounded'], atoms: ['Rachel Adebayo'] },
  },
  {
    id: 'fb-07-fabricated-url',
    source: 'Invoice for Acme Ltd. Total 539.00 GBP. Portal: https://portal.acme.example/9',
    output: 'Download the invoice at https://portal.acme.example/invoice/9.pdf. The total is £539.00.',
    label: { id: 'fb-07-fabricated-url', verdict: 'problem', kinds: ['ungrounded'], atoms: ['https://portal.acme.example/invoice/9.pdf'] },
  },
  {
    id: 'fb-08-inflated-total',
    source: 'Subtotal 400.00 GBP. VAT 80.00 GBP. Invoice INV-9001.',
    output: 'The total due on invoice INV-9001 is £560.00.',
    label: { id: 'fb-08-inflated-total', verdict: 'problem', kinds: ['ungrounded'], atoms: ['£560.00'], note: '400 + 80 is not 560, and 560 is nowhere in the source' },
  },
];

/* ---------------------------------------------------- degenerate and deferral */

const degenerate: readonly Case[] = [
  { id: 'dd-01-empty', source: 'Balance 100.00 GBP.', output: '', label: { id: 'dd-01-empty', verdict: 'problem', kinds: ['degenerate'] } },
  {
    id: 'dd-02-template',
    source: 'Customer Dana Reeve, balance 250.00 GBP due 2026-10-01.',
    output: 'Hi {{ customer.first_name }}, your balance of {{ invoice.total }} is due {{ invoice.due_date }}.',
    label: { id: 'dd-02-template', verdict: 'problem', kinds: ['degenerate'] },
  },
  {
    id: 'dd-03-short-refusal',
    source: 'Balance 250.00 GBP.',
    output: 'I cannot help with that request.',
    label: { id: 'dd-03-short-refusal', verdict: 'problem', kinds: ['deferred'] },
  },
  { id: 'dd-04-null', source: 'Balance 250.00 GBP.', output: 'null', label: { id: 'dd-04-null', verdict: 'problem', kinds: ['degenerate'] } },
  {
    id: 'dd-05-error-text',
    source: 'Balance 250.00 GBP.',
    output: 'Error: ECONNREFUSED while contacting the billing service at 10.0.0.4:5432',
    label: { id: 'dd-05-error-text', verdict: 'problem', kinds: ['degenerate'] },
  },
  {
    id: 'dd-06-defer-to-support',
    source: 'Balance 250.00 GBP due 2026-10-01.',
    output: 'Please reach out to our support team for assistance with this issue.',
    label: { id: 'dd-06-defer-to-support', verdict: 'problem', kinds: ['deferred'] },
  },
];

/* ---------------------------------------------------------------- inconclusive */

const inconclusive: readonly Case[] = [
  {
    id: 'ic-01-no-specifics',
    source: 'The customer asked for a callback about their recent order.',
    output: 'Thank you for getting in touch. A member of the team will call you back shortly to talk this through.',
    label: { id: 'ic-01-no-specifics', verdict: 'inconclusive', note: 'nothing in the answer is checkable against a source' },
  },
  {
    id: 'ic-02-no-source',
    source: '',
    output: 'Your balance is £412.00, due on 2026-10-09.',
    label: { id: 'ic-02-no-source', verdict: 'inconclusive', note: 'specifics, but no material to check them against' },
  },
  {
    id: 'ic-03-acknowledgement',
    source: 'Customer confirmed the address change over the phone.',
    output: 'Noted, thank you. That has been updated on the account.',
    label: { id: 'ic-03-acknowledgement', verdict: 'inconclusive' },
  },
];

/* --------------------------------------------------------- self-contradiction */

const contradiction: readonly Case[] = [
  {
    id: 'sc-01-arithmetic',
    source: 'Subtotal 400.00 GBP, VAT 80.00 GBP, total 520.00 GBP.',
    output: 'Your subtotal is £400.00, VAT is £80.00, and the total due is £520.00.',
    label: { id: 'sc-01-arithmetic', verdict: 'problem', kinds: ['inconsistent'], note: '400 + 80 is 480, not 520' },
  },
  {
    id: 'sc-02-restated-total',
    source: 'Amount outstanding varies by reading; see the statement.',
    output: 'Your total is £560.00. Please pay the amount due of £650.00 by the end of the month.',
    label: { id: 'sc-02-restated-total', verdict: 'problem', kinds: ['inconsistent'], note: 'two different totals in one answer' },
  },
  {
    id: 'sc-03-date-order',
    source: 'Invoice issued 2026-09-20. Payment terms: net 15.',
    output: 'The invoice was issued on 2026-09-20 and payment is due on 2026-09-05.',
    label: { id: 'sc-03-date-order', verdict: 'problem', kinds: ['inconsistent'], note: 'due date precedes the issue date' },
  },
  {
    id: 'sc-04-percentage',
    source: 'Subtotal 500.00 GBP. VAT is charged at 20%.',
    output: 'The subtotal is £500.00 and VAT at 20% comes to £120.00.',
    label: { id: 'sc-04-percentage', verdict: 'problem', kinds: ['inconsistent'], note: '20% of 500 is 100, not 120' },
  },
  {
    id: 'sc-05-consistent',
    source: 'Subtotal 571.00 GBP, VAT 114.20 GBP, total 685.20 GBP.',
    output: 'Subtotal £571.00, VAT £114.20, total due £685.20.',
    label: { id: 'sc-05-consistent', verdict: 'clean', note: 'the figures add up' },
  },
  {
    id: 'sc-06-adjustment-line',
    source: 'Subtotal 400.00 GBP. Shipping 15.00 GBP. VAT 83.00 GBP. Total 498.00 GBP.',
    output: 'Subtotal is £400.00, shipping £15.00, VAT £83.00, for a total of £498.00.',
    label: { id: 'sc-06-adjustment-line', verdict: 'clean', note: 'a shipping line bridges the sum, so the arithmetic check must stand down' },
  },
  {
    id: 'sc-07-date-order-ok',
    source: 'Invoice issued 2026-09-01, due 2026-09-30.',
    output: 'It was issued on 2026-09-01 and is due on 2026-09-30.',
    label: { id: 'sc-07-date-order-ok', verdict: 'clean' },
  },
];

/* ----------------------------------------------------------- structured-output */

const structured: readonly Case[] = [
  {
    id: 'so-01-json-in-prose',
    input: 'Return the account status as valid JSON.',
    source: 'items: 3, status ok',
    output: 'Certainly, here is the JSON you requested:\n{"status":"ok","count":3}',
    label: { id: 'so-01-json-in-prose', verdict: 'problem', kinds: ['malformed'], note: 'a JSON parser will choke on the preamble' },
  },
  {
    id: 'so-02-truncated',
    input: 'List the orders as JSON.',
    source: 'three orders',
    output: '{"orders":[{"id":1},{"id":2},{"id":',
    label: { id: 'so-02-truncated', verdict: 'problem', kinds: ['malformed'], note: 'the object never closes' },
  },
  {
    id: 'so-03-prose-when-json-asked',
    input: 'Respond only with valid JSON.',
    source: 'account balance is 0',
    output: 'The account balance is zero, nothing is owed.',
    label: { id: 'so-03-prose-when-json-asked', verdict: 'problem', kinds: ['malformed'] },
  },
  {
    id: 'so-04-clean-fenced',
    source: 'status ok, three items',
    output: '```json\n{"status":"ok","count":3}\n```',
    label: { id: 'so-04-clean-fenced', verdict: 'inconclusive', note: 'valid JSON, but a fenced code block has no checkable prose atoms' },
  },
  {
    id: 'so-05-clean-bare',
    source: 'the reference is ORD-4471 and the total is 90.00 GBP',
    output: '{"reference":"ORD-4471","total":"90.00 GBP"}',
    label: { id: 'so-05-clean-bare', verdict: 'clean', note: 'parses, and both values trace to the source' },
  },
];

/* -------------------------------------------------------------------- assembly */

function casesToRecords(cases: readonly Case[]): { records: readonly TaskRecord[]; labels: readonly TaskLabel[] } {
  return {
    records: cases.map((k) => ({
      id: k.id,
      input: k.input ?? 'Answer the customer using the material provided.',
      sources: k.source ? [k.source] : [],
      output: k.output,
    })),
    labels: cases.map((k) => k.label),
  };
}

export function builtinBatches(): readonly LabelledBatch[] {
  const faith = casesToRecords(faithful);
  const fab = casesToRecords(fabricated);
  const deg = casesToRecords(degenerate);
  const inc = casesToRecords(inconclusive);
  const con = casesToRecords(contradiction);
  const str = casesToRecords(structured);

  return [
    { name: 'billing-support', synthetic: true, records: demoTasks(), labels: billingLabels },
    { name: 'faithful-adversarial', synthetic: true, records: faith.records, labels: faith.labels },
    { name: 'fabrication-adversarial', synthetic: true, records: fab.records, labels: fab.labels },
    { name: 'degenerate-and-deferral', synthetic: true, records: deg.records, labels: deg.labels },
    { name: 'self-contradiction', synthetic: true, records: con.records, labels: con.labels },
    { name: 'structured-output', synthetic: true, records: str.records, labels: str.labels },
    { name: 'inconclusive', synthetic: true, records: inc.records, labels: inc.labels },
  ];
}
