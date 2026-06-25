import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const [pending, active, denied, pendingDevices] = await Promise.all([
    db.student.count({ where: { status: "PENDING" } }),
    db.student.count({ where: { status: "ACTIVE" } }),
    db.student.count({ where: { status: "DENIED" } }),
    db.device.count({ where: { approved: false } }),
  ]);
  const cards = [
    { label: "Pending students", value: pending },
    { label: "Active students", value: active },
    { label: "Denied students", value: denied },
    { label: "Pending device requests", value: pendingDevices },
  ];
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="text-sm text-slate-500">{c.label}</div>
            <div className="text-2xl font-semibold mt-1">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}