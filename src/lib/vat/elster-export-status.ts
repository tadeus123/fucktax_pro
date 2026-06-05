import { buildElsterExport } from "@/lib/vat/export-elster";

export type ElsterExportStatus = {
  ok: boolean;
  exportReady: boolean;
  vatPayable: number | null;
  validationErrors: string[];
  warnings: string[];
  elsterFields: Record<string, number>;
  message: string;
};

export async function getElsterExportStatus(
  filingPeriodId: string,
): Promise<ElsterExportStatus> {
  const pkg = await buildElsterExport(filingPeriodId);
  if (!pkg) {
    return {
      ok: false,
      exportReady: false,
      vatPayable: null,
      validationErrors: ["Nothing to export — upload documents and bank CSV, then run Continue."],
      warnings: [],
      elsterFields: {},
      message: "ELSTER export not available yet.",
    };
  }

  return {
    ok: true,
    exportReady: pkg.exportReady,
    vatPayable: pkg.rollup.vatPayable,
    validationErrors: pkg.validationErrors,
    warnings: pkg.rollup.warnings.slice(0, 8),
    elsterFields: pkg.rollup.elsterFields,
    message: pkg.exportReady
      ? `ELSTER XML ready. VAT payable €${pkg.rollup.vatPayable.toFixed(2)}.`
      : `ELSTER XML blocked: ${pkg.validationErrors.join(" ")}`,
  };
}

export function formatElsterBlockersForChat(status: ElsterExportStatus): string {
  if (status.exportReady) {
    return `\n\n**ELSTER XML:** Ready for Mein ELSTER import. VAT payable **€${status.vatPayable?.toFixed(2) ?? "?"}**. Use **ELSTER XML** above to download — import only, do not submit until reviewed.`;
  }
  if (status.validationErrors.length === 0) return "";
  return `\n\n**ELSTER XML — not ready:**\n${status.validationErrors.map((e) => `- ${e}`).join("\n")}`;
}

export function mentionsElsterTopic(text: string): boolean {
  return /\belster\b|xml|voranmeldung|ustva|mein elster/i.test(text);
}

export function elsterStatusToToolResult(status: ElsterExportStatus): Record<string, unknown> {
  return {
    ok: status.ok,
    exportReady: status.exportReady,
    message: status.message,
    vatPayable: status.vatPayable,
    validationErrors: status.validationErrors,
    warnings: status.warnings,
    elsterFields: status.elsterFields,
  };
}
