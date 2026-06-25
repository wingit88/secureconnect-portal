import { db } from "@/lib/db";
import { listActiveSessions, type ActiveSession } from "@/lib/mikrotik";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [pending, active, denied, pendingDevices] = await Promise.all([
    db.student.count({ where: { status: "PENDING" } }),
    db.student.count({ where: { status: "ACTIVE" } }),
    db.student.count({ where: { status: "DENIED" } }),
    db.device.count({ where: { approved: false } }),
  ]);
  let activeSessions: ActiveSession[] = [];
  let activeSessionsError = false;
  try {
    activeSessions = await listActiveSessions();
  } catch (err) {
    console.error("Failed to load active hotspot sessions", err);
    activeSessionsError = true;
  }
  const cards = [
    { label: "Pending students", value: pending },
    { label: "Active students", value: active },
    { label: "Denied students", value: denied },
    { label: "Active hotspot sessions", value: activeSessions.length },
    { label: "Pending device requests", value: pendingDevices },
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-sm text-slate-500">{c.label}</div>
            <div className="text-2xl font-semibold mt-1">{c.value}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50">
          <div className="text-sm font-semibold">Live Wi-Fi sessions</div>
          <div className="text-xs text-slate-500">Showing current hotspot sessions from MikroTik.</div>
        </div>
        {activeSessionsError ? (
          <div className="p-4 text-sm text-rose-600">Unable to load active hotspot sessions.</div>
        ) : activeSessions.length === 0 ? (
          <div className="p-4 text-sm text-slate-500">No active hotspot sessions.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="p-3">User</th>
                  <th className="p-3">MAC</th>
                  <th className="p-3">IP</th>
                  <th className="p-3">Uptime</th>
                </tr>
              </thead>
              <tbody>
                {activeSessions.slice(0, 20).map((session) => (
                  <tr key={session.id} className="border-t border-slate-100">
                    <td className="p-3 font-mono">{session.user}</td>
                    <td className="p-3 font-mono">{session.macAddress}</td>
                    <td className="p-3">{session.address ?? "—"}</td>
                    <td className="p-3">{session.uptime ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}