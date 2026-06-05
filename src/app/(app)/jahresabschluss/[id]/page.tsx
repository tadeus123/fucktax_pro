import { notFound } from "next/navigation";
import { EmptyFilingView } from "@/components/EmptyFilingView";
import { getGenericFilingByRoute } from "@/lib/supabase/queries";

export default async function JahresabschlussPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const filing = await getGenericFilingByRoute("jahresabschluss", id);

  if (!filing) {
    notFound();
  }

  return <EmptyFilingView filing={filing} />;
}
