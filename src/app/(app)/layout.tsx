import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-hidden bg-zinc-950">{children}</main>
    </div>
  );
}
