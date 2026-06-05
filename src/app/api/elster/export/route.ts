import { NextRequest, NextResponse } from "next/server";
import { buildElsterExport } from "@/lib/vat/export-elster";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const filingPeriodId = request.nextUrl.searchParams.get("filingPeriodId")?.trim();
  const format = request.nextUrl.searchParams.get("format")?.trim() ?? "xml";

  if (!filingPeriodId) {
    return NextResponse.json({ error: "Missing filingPeriodId" }, { status: 400 });
  }

  const pkg = await buildElsterExport(filingPeriodId);
  if (!pkg) {
    return NextResponse.json({ error: "Nothing to export — run Continue first." }, { status: 404 });
  }

  const safeName = pkg.filingLabel.replace(/\s+/g, "-").toLowerCase();

  if (format === "json") {
    return NextResponse.json({
      filing: pkg.filingLabel,
      year: pkg.year,
      elsterPeriod: pkg.elsterPeriod,
      steuernummer: pkg.steuernummer,
      vatPayable: pkg.rollup.vatPayable,
      elsterFields: pkg.rollup.elsterFields,
      includedDocuments: pkg.rollup.includedDocuments,
      excludedDocuments: pkg.rollup.excludedDocuments,
      warnings: pkg.rollup.warnings,
      validationErrors: pkg.validationErrors,
      exportReady: pkg.exportReady,
    });
  }

  if (!pkg.exportReady && format === "xml") {
    return NextResponse.json(
      { error: "Export blocked", validationErrors: pkg.validationErrors },
      { status: 422 },
    );
  }

  if (format === "csv") {
    return new NextResponse(pkg.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ustva-${safeName}.csv"`,
      },
    });
  }

  return new NextResponse(new Uint8Array(pkg.xmlBuffer), {
    headers: {
      "Content-Type": "application/xml; charset=ISO-8859-15",
      "Content-Disposition": `attachment; filename="ustva-${safeName}-mein-elster.xml"`,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { filingPeriodId?: string };
  const filingPeriodId = body.filingPeriodId?.trim();
  if (!filingPeriodId) {
    return NextResponse.json({ error: "Missing filingPeriodId" }, { status: 400 });
  }

  const pkg = await buildElsterExport(filingPeriodId);
  if (!pkg) {
    return NextResponse.json({ error: "Nothing to export" }, { status: 404 });
  }

  return NextResponse.json({
    ok: pkg.exportReady,
    vatPayable: pkg.rollup.vatPayable,
    elsterFields: pkg.rollup.elsterFields,
    includedDocuments: pkg.rollup.includedDocuments,
    excludedDocuments: pkg.rollup.excludedDocuments,
    warnings: pkg.rollup.warnings,
    validationErrors: pkg.validationErrors,
    exportReady: pkg.exportReady,
    downloadUrl: pkg.exportReady
      ? `/api/elster/export?filingPeriodId=${encodeURIComponent(filingPeriodId)}&format=xml`
      : null,
  });
}
