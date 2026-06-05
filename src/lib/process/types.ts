export type confidence_level = "safe" | "likely" | "review" | "do_not_deduct";

export type ProcessedDocumentSummary = {
  filename: string;
  counterparty: string | null;
  grossAmount: number | null;
  vatAmount: number | null;
  invoiceNumber: string | null;
  matchedBank: boolean;
  confidence: string;
  status: "extracted" | "skipped" | "failed";
  error?: string;
};

export type ProcessResult = {
  sessionId: string;
  documentsProcessed: number;
  bankTransactions: number;
  matched: number;
  needsReview: number;
  recentDocuments?: ProcessedDocumentSummary[];
  failures?: string[];
  vatPayable?: number;
  inputVatDeductible?: number;
  elsterApplied?: number;
  includedDocuments?: number;
  excludedDocuments?: number;
  exportReady?: boolean;
  repaired?: number;
  bankFilled?: number;
};
