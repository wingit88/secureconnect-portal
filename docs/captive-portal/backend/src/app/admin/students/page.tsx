"use client";
import { useEffect, useState } from "react";

type Device = { id: string; macAddress: string; approved: boolean; reason: string | null };
type Student = { id: string; studentId: string; status: "PENDING" | "ACTIVE" | "DENIED"; createdAt: string; devices: Device[] };

export default function StudentsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    const url = new URL("/api/admin/students", window.location.origin);
    if (q) url.searchParams.set("q", q);
    if (status) url.searchParams.set("status", status);
    const res = await fetch(url);
    const data = await res.json();
    setStudents(data.students);
    setBusy(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function act(path: string, payload: object) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) alert(await res.text()); else load();
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Students</h1>
      <div className="flex gap-2 items-end">
        <input className="px-3 py-2 border rounded-md" placeholder="Search Student ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="px-3 py-2 border rounded-md" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="ACTIVE">Active</option>
          <option value="DENIED">Denied</option>
        </select>
        <button onClick={load} className="px-4 py-2 bg-slate-900 text-white rounded-md">Search</button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr><th className="p-3">Student ID</th><th className="p-3">Status</th><th className="p-3">Devices</th><th className="p-3 w-0 whitespace-nowrap">Actions</th></tr>
          </thead>
          <tbody>
            {busy && <tr><td colSpan={4} className="p-4 text-slate-500">Loading…</td></tr>}
            {!busy && students.length === 0 && <tr><td colSpan={4} className="p-4 text-slate-500">No students.</td></tr>}
            {students.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <td className="p-3 font-mono">{s.studentId}</td>
                <td className="p-3"><span className={
                  s.status === "ACTIVE" ? "text-green-700" : s.status === "DENIED" ? "text-red-700" : "text-amber-700"
                }>{s.status}</span></td>
                <td className="p-3">
                  {s.devices.length === 0 ? <span className="text-slate-400">none</span> : (
                    <ul className="space-y-1">
                      {s.devices.map((d) => (
                        <li key={d.id} className="font-mono text-xs">
                          {d.macAddress} {d.approved ? "✓" : <em className="text-amber-600">pending</em>}
                          {d.reason && <span className="text-slate-500"> — {d.reason}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="p-3 space-x-2 whitespace-nowrap">
                  {s.status === "PENDING" && (
                    <button onClick={() => act("/api/admin/approve-student", { studentId: s.studentId })} className="px-2 py-1 text-xs bg-green-600 text-white rounded">Approve</button>
                  )}
                  {s.status !== "DENIED" && (
                    <button onClick={() => confirm(`Revoke ${s.studentId}?`) && act("/api/admin/revoke", { studentId: s.studentId })} className="px-2 py-1 text-xs bg-red-600 text-white rounded">Revoke</button>
                  )}
                  {s.status === "PENDING" && (
                    <button onClick={() => act("/api/admin/deny-student", { studentId: s.studentId })} className="px-2 py-1 text-xs bg-slate-700 text-white rounded">Deny</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}