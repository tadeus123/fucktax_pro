import { CompanyView } from "@/components/CompanyView";
import { getCompanyContent } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function CompanyPage() {
  const content = await getCompanyContent();
  return <CompanyView content={content} />;
}
