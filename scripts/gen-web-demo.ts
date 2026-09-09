/**
 * Emits apps/web/src/data/demo.json from the real engine, so the interactive
 * demo on the marketing page and the CLI cannot disagree. Regenerated in CI;
 * a drift is a failed check.
 */

import { writeFileSync } from 'node:fs';
import { checkGrounding, checkBatch, demoTasks } from '../src/index';

const invoice = `Invoice INV-2026-0412 for Fernweh Supply Ltd
Issued 2026-08-14, due 2026-09-13
Billing contact: accounts@fernweh.example
Subtotal £571.00
VAT £114.20
Total due £685.20
Portal: https://billing.fernweh.example/inv/2026-0412`;

// The answer a support agent produced with that invoice in front of it. Fluent,
// polite, and four of its facts are invented.
const answer =
  'Your outstanding balance is £742.60, including VAT of £123.77, and it is due on 2026-09-30. ' +
  'If you need a copy of the invoice, email finance@fernweh.example and the team will send it over.';

const grounding = checkGrounding(answer, [invoice]);

const { summary } = checkBatch(demoTasks());

const data = {
  invoice,
  answer,
  invented: grounding.ungrounded.map((u) => ({ text: u.text, kind: u.kind, why: u.why })),
  checked: grounding.checked,
  batch: {
    total: summary.total,
    clean: summary.clean,
    problematic: summary.problematic,
    byKind: summary.byKind,
    caveat: summary.caveat,
  },
};

writeFileSync(new URL('../apps/web/src/data/demo.json', import.meta.url), JSON.stringify(data, null, 2) + '\n');
console.log(`apps/web/src/data/demo.json written: ${data.invented.length} invented facts of ${data.checked} checked.`);
