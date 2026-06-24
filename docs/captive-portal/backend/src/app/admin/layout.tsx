import Link from "next/link";
import { getSession } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // login page renders without nav; middleware lets it through unauthenticated
  const session = await getSession();
  if (!session.adminId) return <>{children}</>;

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <nav className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-6">
          <span className="font-semibold">Captive Portal Admin</span>
          <Link href="/admin" className="text-sm text-slate-600 hover:text-slate-900">Dashboard</Link>
          <Link href="/admin/students" className="text-sm text-slate-600 hover:text-slate-900">Students</Link>
          <Link href="/admin/devices" className="text-sm text-slate-600 hover:text-slate-900">Device requests</Link>
          <form action="/api/admin/logout" method="POST" className="ml-auto">
            <button className="text-sm text-slate-500 hover:text-red-600">Sign out ({session.email})</button>
          </form>
        </nav>
      </header>
      <main className="max-w-6xl mx-auto p-4">{children}</main>
    </div>
  );
}

// Force this component to not be statically optimized so getSession() works
export const dynamic = "force-dynamic";