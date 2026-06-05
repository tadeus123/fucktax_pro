import { notFound } from "next/navigation";
import { ReviewView } from "@/components/ReviewView";
import { getReviewData, getVatFilingByRoute } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function VatReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const filing = await getVatFilingByRoute(id);

  if (!filing) {
    notFound();
  }

  const review = await getReviewData(filing.id);

  if (!review) {
    notFound();
  }

  return <ReviewView data={review} filingRoute={id} />;
}
