import {
  buildExtractionUserPrompt,
  EXTRACTION_SYSTEM_PROMPT,
} from "@/lib/process/prompt";
import type { confidence_level } from "@/lib/process/types";

export type DocumentExtraction = {
  document_type: string;
  vat_case: string | null;
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

export type ExtractDocumentOptions = {
  periodStart: string;
  periodEnd: string;
};

const SKIP_EXTENSIONS = [".csv", ".xlsx", ".xls", ".txt", ".zip", ".mt940", ".sta"];

export function shouldSkipDocumentFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return SKIP_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function getOpenAiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim();
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  await parser.destroy();
  return result.text.slice(0, 14000);
}

async function extractPdfPageImages(buffer: Buffer, maxPages = 2): Promise<string[]> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getScreenshot({ first: maxPages, scale: 1.5, desiredWidth: 1200 });
  await parser.destroy();
  return result.pages.map((page) => page.dataUrl);
}

function parseEuroAmount(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s/g, "");
  if (!cleaned) return null;
  const normalized =
    cleaned.includes(",") && cleaned.includes(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/** Regex fallback when AI misses amounts on German invoices. */
function parseAmountsFromGermanInvoiceText(text: string): {
  gross_amount: number | null;
  net_amount: number | null;
  vat_amount: number | null;
  vat_rate: number | null;
} {
  const grossPatterns = [
    /(?:Gesamtbetrag|Rechnungsbetrag|Summe|Brutto|Total(?:betrag)?|Endbetrag)[^\d€]{0,20}€?\s*([\d.\s]+,\d{2}|\d+\.\d{2})/i,
    /€\s*([\d.\s]+,\d{2}|\d+\.\d{2})\s*(?:\(|[^\n]{0,12}(?:brutto|gesamt|total))/i,
  ];
  const netPatterns = [
    /(?:Nettobetrag|Netto|Zwischensumme)[^\d€]{0,20}€?\s*([\d.\s]+,\d{2}|\d+\.\d{2})/i,
  ];
  const vatPatterns = [
    /(?:MwSt|USt|Mehrwertsteuer|VAT)[^\d€]{0,24}€?\s*([\d.\s]+,\d{2}|\d+\.\d{2})/i,
    /(?:MwSt|USt|VAT)[^\d]{0,8}(\d{1,2})\s*%\s*[^\d€]{0,12}€?\s*([\d.\s]+,\d{2}|\d+\.\d{2})/i,
  ];

  let gross_amount: number | null = null;
  for (const pattern of grossPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      gross_amount = parseEuroAmount(match[1]);
      if (gross_amount != null) break;
    }
  }

  let net_amount: number | null = null;
  for (const pattern of netPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      net_amount = parseEuroAmount(match[1]);
      if (net_amount != null) break;
    }
  }

  let vat_amount: number | null = null;
  let vat_rate: number | null = null;
  for (const pattern of vatPatterns) {
    const match = text.match(pattern);
    if (match?.[2]) {
      vat_rate = Number(match[1]);
      vat_amount = parseEuroAmount(match[2]);
      break;
    }
    if (match?.[1]) {
      vat_amount = parseEuroAmount(match[1]);
      if (vat_amount != null) break;
    }
  }

  const rateMatch = text.match(/(\d{1,2})\s*%\s*(?:MwSt|USt|Mehrwertsteuer|VAT)/i);
  if (rateMatch && vat_rate == null) {
    vat_rate = Number(rateMatch[1]);
  }

  if (gross_amount == null && net_amount != null && vat_amount != null) {
    gross_amount = net_amount + vat_amount;
  }

  return { gross_amount, net_amount, vat_amount, vat_rate };
}

function mergeParsedAmounts(
  extraction: DocumentExtraction,
  parsed: ReturnType<typeof parseAmountsFromGermanInvoiceText>,
): DocumentExtraction {
  if (extraction.gross_amount != null || extraction.net_amount != null) return extraction;

  const hasParsed =
    parsed.gross_amount != null || parsed.net_amount != null || parsed.vat_amount != null;
  if (!hasParsed) return extraction;

  return {
    ...extraction,
    gross_amount: parsed.gross_amount ?? extraction.gross_amount,
    net_amount: parsed.net_amount ?? extraction.net_amount,
    vat_amount: parsed.vat_amount ?? extraction.vat_amount,
    vat_rate: parsed.vat_rate ?? extraction.vat_rate ?? 19,
    confidence: extraction.confidence === "do_not_deduct" ? "likely" : extraction.confidence,
    warning: extraction.warning?.includes("Could not read")
      ? null
      : extraction.warning,
  };
}

function guessFromFilename(filename: string): DocumentExtraction {
  const lower = filename.toLowerCase();
  let document_type = "other";
  if (lower.includes("receipt") || lower.includes("beleg")) document_type = "receipt";
  if (lower.includes("invoice") || lower.includes("rechnung") || lower.startsWith("in_"))
    document_type = "supplier_invoice";
  if (lower.includes("mahnung")) document_type = "other";
  if (lower.includes("customs") || lower.includes("zoll")) document_type = "customs";

  return {
    document_type,
    vat_case: null,
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

function normalizeExtraction(parsed: Record<string, unknown>): DocumentExtraction {
  const confidence = String(parsed.confidence ?? "review") as confidence_level;
  const validConfidence = ["safe", "likely", "review", "do_not_deduct"].includes(confidence)
    ? confidence
    : "review";

  const num = (key: string) => {
    const value = parsed[key];
    if (value == null || value === "") return null;
    const n = Number(String(value).replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  return {
    document_type: String(parsed.document_type ?? "other"),
    vat_case: parsed.vat_case ? String(parsed.vat_case) : null,
    counterparty_name: parsed.counterparty_name ? String(parsed.counterparty_name) : null,
    invoice_number: parsed.invoice_number ? String(parsed.invoice_number) : null,
    invoice_date: parsed.invoice_date ? String(parsed.invoice_date) : null,
    leistungsdatum: parsed.leistungsdatum ? String(parsed.leistungsdatum) : null,
    net_amount: num("net_amount"),
    vat_rate: num("vat_rate"),
    vat_amount: num("vat_amount"),
    gross_amount: num("gross_amount"),
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

async function callOpenAi(
  messages: Array<Record<string, unknown>>,
  model: string,
): Promise<DocumentExtraction | null> {
  const apiKey = getOpenAiKey();
  if (!apiKey) return null;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const raw = payload.choices?.[0]?.message?.content ?? "{}";
  return normalizeExtraction(JSON.parse(raw) as Record<string, unknown>);
}

async function extractWithOpenAi(
  filename: string,
  mimeType: string | null,
  buffer: Buffer,
  options: ExtractDocumentOptions,
): Promise<DocumentExtraction> {
  const apiKey = getOpenAiKey();
  if (!apiKey) {
    return {
      ...guessFromFilename(filename),
      warning: "OPENAI_API_KEY missing — cannot extract invoice data.",
      raw_extraction: { source: "missing_api_key", filename },
    };
  }

  const isPdf = mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf");
  const isImage =
    mimeType?.startsWith("image/") ?? /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(filename);

  const userPromptBase = buildExtractionUserPrompt(
    filename,
    options.periodStart,
    options.periodEnd,
  );

  if (isImage) {
    const base64 = buffer.toString("base64");
    const mediaType = mimeType ?? "image/jpeg";
    const result = await callOpenAi(
      [
        { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userPromptBase },
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
          ],
        },
      ],
      "gpt-4o",
    );
    return result ?? { ...guessFromFilename(filename), warning: "AI vision failed" };
  }

  if (isPdf) {
    let text = "";
    try {
      text = await extractPdfText(buffer);
    } catch {
      text = "";
    }

    if (text.trim().length >= 200) {
      const textResult = await callOpenAi(
        [
          { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildExtractionUserPrompt(
              filename,
              options.periodStart,
              options.periodEnd,
              text,
            ),
          },
        ],
        "gpt-4o",
      );
      if (textResult?.gross_amount != null || textResult?.net_amount != null) {
        return textResult;
      }
      if (textResult) {
        const merged = mergeParsedAmounts(textResult, parseAmountsFromGermanInvoiceText(text));
        if (merged.gross_amount != null || merged.net_amount != null) return merged;
      } else {
        const parsedOnly = parseAmountsFromGermanInvoiceText(text);
        if (parsedOnly.gross_amount != null || parsedOnly.net_amount != null) {
          return mergeParsedAmounts(guessFromFilename(filename), parsedOnly);
        }
      }
    }

    try {
      const pageImages = await extractPdfPageImages(buffer, 2);
      if (pageImages.length > 0) {
        const visionResult = await callOpenAi(
          [
            { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: userPromptBase },
                ...pageImages.map((url) => ({
                  type: "image_url",
                  image_url: { url },
                })),
              ],
            },
          ],
          "gpt-4o",
        );
        if (visionResult) {
          if (visionResult.gross_amount != null || visionResult.net_amount != null) {
            return visionResult;
          }
          if (text.trim().length >= 200) {
            return mergeParsedAmounts(visionResult, parseAmountsFromGermanInvoiceText(text));
          }
          return visionResult;
        }
      }
    } catch {
      // fall through
    }

    return {
      ...guessFromFilename(filename),
      warning: "PDF could not be parsed — check manually.",
    };
  }

  return guessFromFilename(filename);
}

export async function extractDocument(
  filename: string,
  mimeType: string | null,
  buffer: Buffer,
  options: ExtractDocumentOptions,
): Promise<DocumentExtraction> {
  if (shouldSkipDocumentFile(filename)) {
    return {
      ...guessFromFilename(filename),
      document_type: "other",
      confidence: "do_not_deduct",
      warning: "Not a document — skipped (spreadsheet/export).",
    };
  }

  try {
    return await extractWithOpenAi(filename, mimeType, buffer, options);
  } catch {
    return guessFromFilename(filename);
  }
}
