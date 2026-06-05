import { notFound, redirect } from "next/navigation";
import { VatFilingView } from "@/components/VatFilingView";
import { getUploadStatus, getVatFilingByRoute } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function VatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const filing = await getVatFilingByRoute(id);

  if (!filing) {
    notFound();
  }

  const status = await getUploadStatus(filing.id);
  if (status.documents > 0 && status.bank > 0) {
    redirect(`/vat/${id}/review`);
  }

  return <VatFilingView filing={filing} />;
}
