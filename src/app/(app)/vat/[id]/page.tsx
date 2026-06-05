import { notFound } from "next/navigation";
import { VatFilingView } from "@/components/VatFilingView";
import { getVatFilingByRoute } from "@/lib/supabase/queries";

export default async function VatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const filing = await getVatFilingByRoute(id);

  if (!filing) {
    notFound();
  }

  return <VatFilingView filing={filing} />;
}
