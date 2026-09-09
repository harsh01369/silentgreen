window.SGAI = {
  "total": 20,
  "clean": 13,
  "problematic": 7,
  "headline": "7 of 20 answers (35%) contain something the pipeline reported as a success.",
  "caveat": "This checks whether an answer is empty, refused, unrendered, deferred, duplicated, self-contradictory, malformed when it should be structured, or contains specifics absent from its own source material. It does not check whether the answer is wise, complete or appropriate, and a clean result is not a claim that the work was good. No model was asked to grade another model.",
  "byKind": {
    "degenerate": 2,
    "ungrounded": 4,
    "deferred": 1,
    "duplicated": 3,
    "inconsistent": 0,
    "malformed": 0
  },
  "fabricated": {
    "id": "task-004",
    "output": "Your outstanding balance is £742.60, including VAT of £123.77, and it is due on 2026-09-30. If you need a copy, email finance@fernweh.example.",
    "source": "Invoice INV-2026-0403 for Fernweh Supply Ltd\nIssued 2026-08-04, due 2026-09-04\nBilling contact: accounts@fernweh.example\nSubtotal £539.00\nVAT £107.80\nPortal: https://billing.fernweh.example/inv/2026-0403",
    "ungrounded": [
      {
        "text": "finance@fernweh.example",
        "kind": "email",
        "why": "an email address that does not appear in the source, which means it was either invented or carried in from somewhere else"
      },
      {
        "text": "£742.60",
        "kind": "money",
        "why": "a monetary amount that appears nowhere in the material the model was given"
      },
      {
        "text": "£123.77",
        "kind": "money",
        "why": "a monetary amount that appears nowhere in the material the model was given"
      },
      {
        "text": "2026-09-30",
        "kind": "date",
        "why": "a date that does not appear in the source"
      }
    ]
  },
  "flagged": [
    {
      "id": "task-004",
      "output": "Your outstanding balance is £742.60, including VAT of £123.77, and it is due on 2026-09-30. If you need a copy, email finance@fernweh.example.",
      "problems": [
        {
          "kind": "ungrounded",
          "summary": "\"finance@fernweh.example\" is an email address that does not appear in the source, which means it was either invented or carried in from somewhere else.",
          "evidence": "finance@fernweh.example"
        },
        {
          "kind": "ungrounded",
          "summary": "\"£742.60\" is a monetary amount that appears nowhere in the material the model was given.",
          "evidence": "£742.60"
        },
        {
          "kind": "ungrounded",
          "summary": "\"£123.77\" is a monetary amount that appears nowhere in the material the model was given.",
          "evidence": "£123.77"
        },
        {
          "kind": "ungrounded",
          "summary": "\"2026-09-30\" is a date that does not appear in the source.",
          "evidence": "2026-09-30"
        }
      ]
    },
    {
      "id": "task-008",
      "output": "Hi {{ customer.first_name }}, your balance of {{ invoice.total }} is due on {{ invoice.due_date }}.",
      "problems": [
        {
          "kind": "degenerate",
          "summary": "The answer still contains an unrendered template expression, so a value was never substituted in.",
          "evidence": "Hi {{ customer.first_name }}, your balance of {{ invoice.total }} is due on {{ invoice.due_date }}."
        }
      ]
    },
    {
      "id": "task-012",
      "output": "I'm sorry, but I cannot access billing information for this account.",
      "problems": [
        {
          "kind": "degenerate",
          "summary": "The answer contains a model refusal, so the AI step declined and the workflow carried the refusal downstream as if it were content.",
          "evidence": "I'm sorry, but I cannot access billing information for this account."
        }
      ]
    },
    {
      "id": "task-015",
      "output": "Thanks for getting in touch. Please contact our support team and they will be able to help you with this.",
      "problems": [
        {
          "kind": "deferred",
          "summary": "The answer hands the task back rather than doing it. This counts as a completed task in most pipelines, which is how a high resolution rate can coexist with nothing being resolved.",
          "evidence": "Please contact our support"
        }
      ]
    },
    {
      "id": "task-017",
      "output": "Your invoice is available in the billing portal. Please log in to view the current balance and due date.",
      "problems": [
        {
          "kind": "duplicated",
          "summary": "This exact answer was produced for 3 different tasks, which usually means the pipeline stopped reading its input.",
          "evidence": "Your invoice is available in the billing portal. Please log in to view the current balance and due date."
        }
      ]
    },
    {
      "id": "task-018",
      "output": "Your invoice is available in the billing portal. Please log in to view the current balance and due date.",
      "problems": [
        {
          "kind": "duplicated",
          "summary": "This exact answer was produced for 3 different tasks, which usually means the pipeline stopped reading its input.",
          "evidence": "Your invoice is available in the billing portal. Please log in to view the current balance and due date."
        }
      ]
    },
    {
      "id": "task-019",
      "output": "Your invoice is available in the billing portal. Please log in to view the current balance and due date.",
      "problems": [
        {
          "kind": "duplicated",
          "summary": "This exact answer was produced for 3 different tasks, which usually means the pipeline stopped reading its input.",
          "evidence": "Your invoice is available in the billing portal. Please log in to view the current balance and due date."
        }
      ]
    }
  ]
};
