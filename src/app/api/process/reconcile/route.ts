import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/supabase/server";

function daysBetween(a: string, b: string): number {
  const da = new Date(a);
  const db = new Date(b);
  return Math.abs(da.getTime() - db.getTime()) / 86400000;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { filingPeriodId?: string };
    const filingPeriodId = body.filingPeriodId?.trim();
    if (!filingPeriodId) {
      return NextResponse.json({ error: "Missing filingPeriodId" }, { status: 400 });
    }

    const supabase = createSupabaseAdmin();

    const { data: session } = await supabase
      .from("upload_sessions")
      .select("id")
      .eq("filing_period_id", filingPeriodId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      return NextResponse.json({ error: "No upload session" }, { status: 400 });
    }

    await supabase
      .from("bank_transactions")
      .update({ matched_document_id: null, reconciliation_status: "unmatched" })
      .eq("session_id", session.id);

    const [{ data: documents }, { data: transactions }] = await Promise.all([
      supabase
        .from("document_records")
        .select("id, gross_amount, invoice_date, payment_date")
        .eq("filing_period_id", filingPeriodId),
      supabase
        .from("bank_transactions")
        .select("id, amount, transaction_date, matched_document_id, reconciliation_status")
        .eq("session_id", session.id)
        .eq("reconciliation_status", "unmatched"),
    ]);

    let matched = 0;
    for (const doc of documents ?? []) {
      if (doc.gross_amount == null) continue;
      const gross = Number(doc.gross_amount);
      const docDate = doc.payment_date ?? doc.invoice_date;

      const candidate = (transactions ?? []).find((tx) => {
        if (tx.matched_document_id) return false;
        const amount = Number(tx.amount);
        const amountMatch =
          Math.abs(amount + gross) <= 0.05 || Math.abs(amount - gross) <= 0.05;
        if (!amountMatch) return false;
        if (docDate && daysBetween(String(docDate), tx.transaction_date) > 28) return false;
        return true;
      });

      if (!candidate) continue;

      await supabase
        .from("bank_transactions")
        .update({ matched_document_id: doc.id, reconciliation_status: "matched" })
        .eq("id", candidate.id);

      candidate.matched_document_id = doc.id;
      matched += 1;
    }

    return NextResponse.json({ ok: true, matched });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reconcile failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
