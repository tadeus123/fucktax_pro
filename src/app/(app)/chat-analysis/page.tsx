import { ChatAnalysisView } from "@/components/ChatAnalysisView";
import { getSidebarFilings } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function ChatAnalysisPage() {
  const filings = await getSidebarFilings();
  const options = filings.map((f) => ({
    id: f.href.split("/").pop() ?? f.href,
    label: f.label,
  }));

  return <ChatAnalysisView filings={options} />;
}
