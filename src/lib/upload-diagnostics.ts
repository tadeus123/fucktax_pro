import { createSupabaseAdmin } from "@/lib/supabase/server";

export async function getUploadDiagnostics() {
  const supabase = createSupabaseAdmin();

  const [
    { data: filings, error: filingsError },
    { data: sessions, error: sessionsError },
    { data: files, error: filesError },
    { data: events, error: eventsError },
  ] = await Promise.all([
    supabase.from("filing_periods").select("id, label, filing_type").order("sort_order"),
    supabase
      .from("upload_sessions")
      .select("id, filing_period_id, status, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("uploaded_files")
      .select(
        "id, session_id, kind, original_filename, mime_type, size_bytes, processing_status, error_message, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("app_events")
      .select("level, source, message, context, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const error = filingsError ?? sessionsError ?? filesError;
  if (error) {
    throw new Error(error.message);
  }

  const filesBySession = new Map<string, typeof files>();
  for (const file of files ?? []) {
    const list = filesBySession.get(file.session_id) ?? [];
    list.push(file);
    filesBySession.set(file.session_id, list);
  }

  const filingSummaries = (filings ?? []).map((filing) => {
    const filingSessions = (sessions ?? []).filter((s) => s.filing_period_id === filing.id);
    const sessionIds = new Set(filingSessions.map((s) => s.id));
    const filingFiles = (files ?? []).filter((file) => sessionIds.has(file.session_id));
    const documents = filingFiles.filter((f) => f.kind === "document");
    const bank = filingFiles.filter((f) => f.kind === "bank");

    return {
      filingId: filing.id,
      label: filing.label,
      type: filing.filing_type,
      sessions: filingSessions.length,
      documents: documents.length,
      bank: bank.length,
      pending: filingFiles.filter((f) => f.processing_status === "pending").length,
      failed: filingFiles.filter((f) => f.processing_status === "failed").length,
      totalBytes: filingFiles.reduce((sum, f) => sum + Number(f.size_bytes ?? 0), 0),
      sampleDocuments: documents.slice(0, 5).map((f) => f.original_filename),
      sampleBank: bank.slice(0, 5).map((f) => f.original_filename),
    };
  });

  return {
    checkedAt: new Date().toISOString(),
    filings: filingSummaries,
    recentSessions: (sessions ?? []).slice(0, 10).map((session) => {
      const sessionFiles = filesBySession.get(session.id) ?? [];
      return {
        sessionId: session.id,
        filingPeriodId: session.filing_period_id,
        status: session.status,
        createdAt: session.created_at,
        documents: sessionFiles.filter((f) => f.kind === "document").length,
        bank: sessionFiles.filter((f) => f.kind === "bank").length,
      };
    }),
    recentEvents: eventsError ? [] : (events ?? []),
    totals: {
      files: files?.length ?? 0,
      documents: files?.filter((f) => f.kind === "document").length ?? 0,
      bank: files?.filter((f) => f.kind === "bank").length ?? 0,
    },
  };
}
