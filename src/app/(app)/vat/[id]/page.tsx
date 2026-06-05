import { notFound } from "next/navigation";
import { VatFilingView } from "@/components/VatFilingView";
import { getVatFiling } from "@/lib/filings";

export default async function VatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const filing = getVatFiling(id);

  if (!filing) {
    notFound();
  }

  return <VatFilingView filing={filing} />;
}
