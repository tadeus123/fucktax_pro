import { notFound } from "next/navigation";
import { EmptyFilingView } from "@/components/EmptyFilingView";
import { STEUERERKLAERUNG } from "@/lib/filings";

export default async function SteuerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const filing = STEUERERKLAERUNG.find((f) => f.id === id);

  if (!filing) {
    notFound();
  }

  return <EmptyFilingView filing={filing} />;
}
