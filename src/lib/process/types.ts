export type confidence_level = "safe" | "likely" | "review" | "do_not_deduct";

export type ProcessResult = {
  sessionId: string;
  documentsProcessed: number;
  bankTransactions: number;
  matched: number;
  needsReview: number;
};
