import { notFound } from "next/navigation";
import { EmptyFilingView } from "@/components/EmptyFilingView";
import { JAHRESABSCHLUSS } from "@/lib/filings";

export default async function JahresabschlussPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const filing = JAHRESABSCHLUSS.find((f) => f.id === id);

  if (!filing) {
    notFound();
  }

  return <EmptyFilingView filing={filing} comingSoonLabel="Jahresabschluss" />;
}
