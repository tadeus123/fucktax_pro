export const ASSISTANT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "exclude_documents_matching",
      description:
        "Remove documents from ELSTER filing (private spend, no Beleg, wrong period). Matches filename or counterparty.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Substring to match, e.g. safeway, cursor" },
          reason: { type: "string", description: "Short note stored on the record" },
        },
        required: ["pattern", "reason"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "set_document_filing",
      description:
        "Set VAT case and amounts on documents for ELSTER. Use when user confirms treatment on invoices/receipts we have.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          vat_case: {
            type: "string",
            enum: [
              "de_supplier_19",
              "de_supplier_7",
              "de_customer_19",
              "eu_b2b_supplier_rc",
              "non_eu_service_rc",
              "import_goods",
              "eu_b2b_customer",
              "non_eu_customer",
              "restaurant_hospitality",
              "private_mixed",
            ],
          },
          confidence: { type: "string", enum: ["safe", "likely", "review", "do_not_deduct"] },
          gross_amount: { type: "number" },
          net_amount: { type: "number" },
          vat_amount: { type: "number" },
          vat_rate: { type: "number" },
          note: { type: "string" },
        },
        required: ["pattern", "vat_case"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "confirm_bank_lines_matching",
      description:
        "Apply VAT treatment to unmatched bank lines (e.g. reverse charge for Cursor/Notion using bank amount). Updates ELSTER roll-up.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          vat_case: {
            type: "string",
            enum: [
              "non_eu_service_rc",
              "eu_b2b_supplier_rc",
              "de_supplier_19",
              "private_mixed",
              "internal_transfer",
              "payment_without_invoice",
            ],
          },
          note: { type: "string" },
        },
        required: ["pattern", "vat_case", "note"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "exclude_bank_lines_matching",
      description: "Mark bank lines as excluded/resolved with no VAT effect (transfers, private).",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          note: { type: "string" },
        },
        required: ["pattern", "note"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_web",
      description:
        "Search the internet for company/vendor info, VAT treatment, what a counterparty does. Use when user says search online or vendor on bank line is unknown (e.g. PNL Fintech B.V.).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query, e.g. PNL Fintech B.V. company VAT Germany",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_recovery_opportunities",
      description:
        "Get bank-first triage: which unmatched payments to ask user about (invoice upload) vs auto-file from bank (reverse charge, exclude). Use on first message or when user asks what is missing.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_filing_data",
      description:
        "Search unmatched bank lines and documents by substring (cursor, wallet, safeway). Call before exclude/confirm when you need counts or to verify a pattern.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Case-insensitive substring" },
          scope: { type: "string", enum: ["bank", "documents", "both"], default: "both" },
          limit: { type: "number", description: "Max rows per scope, default 25" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "apply_smart_defaults",
      description:
        "Auto-exclude wallet transfers, obvious US private retail, and similar — use when user says 'just make it work' or 'clean it up'.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "refresh_elster_export",
      description:
        "Recalculate ELSTER Kennzahlen after applying changes. ALWAYS call after any exclude/confirm/set actions.",
      parameters: { type: "object", properties: {} },
    },
  },
];
