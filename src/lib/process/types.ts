export type confidence_level = "safe" | "likely" | "review" | "do_not_deduct";

export type ProcessedDocumentSummary = {
  filename: string;
  counterparty: string | null;
  grossAmount: number | null;
  vatAmount: number | null;
  invoiceNumber: string | null;
  matchedBank: boolean;
  confidence: string;
};

export type ProcessResult = {
  sessionId: string;
  documentsProcessed: number;
  bankTransactions: number;
  matched: number;
  needsReview: number;
  recentDocuments?: ProcessedDocumentSummary[];
};
