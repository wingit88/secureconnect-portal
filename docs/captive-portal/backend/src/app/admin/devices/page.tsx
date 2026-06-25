"use client";
import { useEffect, useState } from "react";

type Row = {
  id: string; macAddress: string; reason: string | null; createdAt: string;
  syncState: string; syncAttempts: number; lastSyncError: string | null;
  student: { studentId: string; status: string };
};

export default function DevicesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    // reuse /api/admin/students and flatten pending devices
    const res = await fetch("/api/admin/students");
    const data = await res.json();
    const flat: Row[] = [];
    for (const s of data.students) {
      for (const d of s.devices) {
        if (!d.approved) flat.push({ ...d, student: { studentId: s.studentId, status: s.status } });
      }
    }
    setRows(flat);
    setBusy(false);
  }
  useEffect(() => { load(); }, []);

  async function act(path: string, payload: object) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) alert(await res.text()); else load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Pending device requests</h1>
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr><th className="p-3">Student</th><th className="p-3">MAC</th><th className="p-3">Reason</th><th className="p-3">Sync</th><th className="p-3">Actions</th></tr>
          </thead>
          <tbody>
            {busy && <tr><td colSpan={5} className="p-4 text-slate-500">Loading…</td></tr>}
            {!busy && rows.length === 0 && <tr><td colSpan={5} className="p-4 text-slate-500">No pending requests.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-3 font-mono">{r.student.studentId} <span className="text-xs text-slate-500">({r.student.status})</span></td>
                <td className="p-3 font-mono">{r.macAddress}</td>
                <td className="p-3">{r.reason ?? "—"}</td>
                <td className="p-3">
                  <div className="text-xs">
                    <span className="font-medium">{r.syncState}</span>
                    {r.syncAttempts > 0 ? <span className="text-slate-500"> · attempts {r.syncAttempts}</span> : null}
                    {r.lastSyncError ? <div className="text-rose-600 mt-1">{r.lastSyncError}</div> : null}
                  </div>
                </td>
                <td className="p-3 space-x-2 whitespace-nowrap">
                  <button onClick={() => act("/api/admin/approve-device", { deviceId: r.id })}
                    disabled={r.student.status !== "ACTIVE"}
                    title={r.student.status !== "ACTIVE" ? "Approve the student first" : ""}
                    className="px-2 py-1 text-xs bg-green-600 text-white rounded disabled:opacity-40">Approve</button>
                  <button onClick={() => act("/api/admin/reject-device", { deviceId: r.id })}
                    className="px-2 py-1 text-xs bg-red-600 text-white rounded">Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}