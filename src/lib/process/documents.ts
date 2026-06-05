import type { confidence_level } from "@/lib/process/types";

export type DocumentExtraction = {
  document_type: string;
  counterparty_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  leistungsdatum: string | null;
  net_amount: number | null;
  vat_rate: number | null;
  vat_amount: number | null;
  gross_amount: number | null;
  currency: string;
  country: string | null;
  vat_id: string | null;
  reverse_charge_text: string | null;
  counterparty_type: string | null;
  vat_shown: string | null;
  vat_treatment: string | null;
  confidence: confidence_level;
  warning: string | null;
  raw_extraction: Record<string, unknown>;
};

function getOpenAiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim();
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text.slice(0, 12000);
}

function guessFromFilename(filename: string): DocumentExtraction {
  const lower = filename.toLowerCase();
  let document_type = "other";
  if (lower.includes("receipt") || lower.includes("beleg")) document_type = "receipt";
  if (lower.includes("invoice") || lower.includes("rechnung")) document_type = "supplier_invoice";
  if (lower.includes("customs") || lower.includes("zoll")) document_type = "customs";

  return {
    document_type,
    counterparty_name: null,
    invoice_number: null,
    invoice_date: null,
    leistungsdatum: null,
    net_amount: null,
    vat_rate: null,
    vat_amount: null,
    gross_amount: null,
    currency: "EUR",
    country: "DE",
    vat_id: null,
    reverse_charge_text: null,
    counterparty_type: null,
    vat_shown: null,
    vat_treatment: null,
    confidence: "review",
    warning: "Could not read document — please review manually.",
    raw_extraction: { source: "filename_fallback", filename },
  };
}

async function extractWithOpenAi(
  filename: string,
  mimeType: string | null,
  buffer: Buffer,
): Promise<DocumentExtraction> {
  const apiKey = getOpenAiKey();
  if (!apiKey) return guessFromFilename(filename);

  let content = "";
  const isPdf = mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
  const isImage = mimeType?.startsWith("image/") ?? /\.(png|jpe?g|webp|gif|heic)$/i.test(filename);

  if (isPdf) {
    try {
      content = await extractPdfText(buffer);
    } catch {
      return guessFromFilename(filename);
    }
  }

  const messages: Array<Record<string, unknown>> = [
    {
      role: "system",
      content:
        "You extract German business invoice/receipt data for VAT filing. Return strict JSON only with keys: document_type (supplier_invoice|customer_invoice|receipt|customs|other), counterparty_name, invoice_number, invoice_date (YYYY-MM-DD or null), net_amount, vat_rate, vat_amount, gross_amount, currency, vat_id, confidence (safe|likely|review|do_not_deduct), warning.",
    },
  ];

  if (isImage) {
    const base64 = buffer.toString("base64");
    const mediaType = mimeType ?? "image/jpeg";
    messages.push({
      role: "user",
      content: [
        { type: "text", text: `Extract VAT fields from this document: ${filename}` },
        { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
      ],
    });
  } else {
    messages.push({
      role: "user",
      content: `Extract VAT fields from this document (${filename}):\n\n${content || "[empty text — use filename hints]"}`,
    });
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!response.ok) {
    return {
      ...guessFromFilename(filename),
      warning: `AI extraction failed (${response.status})`,
    };
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = payload.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(raw) as Record<string, unknown>;

  const confidence = String(parsed.confidence ?? "review") as confidence_level;
  const validConfidence = ["safe", "likely", "review", "do_not_deduct"].includes(confidence)
    ? confidence
    : "review";

  return {
    document_type: String(parsed.document_type ?? "other"),
    counterparty_name: parsed.counterparty_name ? String(parsed.counterparty_name) : null,
    invoice_number: parsed.invoice_number ? String(parsed.invoice_number) : null,
    invoice_date: parsed.invoice_date ? String(parsed.invoice_date) : null,
    leistungsdatum: parsed.leistungsdatum ? String(parsed.leistungsdatum) : null,
    net_amount: parsed.net_amount != null ? Number(parsed.net_amount) : null,
    vat_rate: parsed.vat_rate != null ? Number(parsed.vat_rate) : null,
    vat_amount: parsed.vat_amount != null ? Number(parsed.vat_amount) : null,
    gross_amount: parsed.gross_amount != null ? Number(parsed.gross_amount) : null,
    currency: String(parsed.currency ?? "EUR"),
    country: parsed.country ? String(parsed.country) : "DE",
    vat_id: parsed.vat_id ? String(parsed.vat_id) : null,
    reverse_charge_text: parsed.reverse_charge_text ? String(parsed.reverse_charge_text) : null,
    counterparty_type: parsed.counterparty_type ? String(parsed.counterparty_type) : null,
    vat_shown: parsed.vat_shown ? String(parsed.vat_shown) : null,
    vat_treatment: parsed.vat_treatment ? String(parsed.vat_treatment) : null,
    confidence: validConfidence,
    warning: parsed.warning ? String(parsed.warning) : null,
    raw_extraction: parsed,
  };
}

export async function extractDocument(
  filename: string,
  mimeType: string | null,
  buffer: Buffer,
): Promise<DocumentExtraction> {
  try {
    return await extractWithOpenAi(filename, mimeType, buffer);
  } catch {
    return guessFromFilename(filename);
  }
}
