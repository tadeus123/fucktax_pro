import { Sidebar } from "@/components/Sidebar";
import { getSidebarFilings } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const filings = await getSidebarFilings();

  return (
    <div className="flex h-screen overflow-hidden bg-black">
      <Sidebar filings={filings} />
      <main className="no-scrollbar min-w-0 flex-1 overflow-auto">{children}</main>
    </div>
  );
}
