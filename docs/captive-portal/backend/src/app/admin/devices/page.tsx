"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Row = {
  id: string;
  macAddress: string;
  hostname: string | null;
  reason: string | null;
  createdAt: string;
  student: { id: string; studentId: string; nama: string; kelas: string; status: string };
};

type ActionPayload = {
  deviceId?: string;
  studentId?: string;
};

export default function DevicesPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    const res = await fetch("/api/admin/students");
    const data = await res.json();
    const flat: Row[] = [];
    for (const s of data.students) {
      for (const d of s.devices) {
        if (!d.approved) {
          flat.push({
            ...d,
            student: { id: s.id, studentId: s.studentId, nama: s.nama, kelas: s.kelas, status: s.status },
          });
        }
      }
    }
    setRows(flat);
    setBusy(false);
  }
  useEffect(() => { load(); }, []);

  async function act(path: string, payload: ActionPayload) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      alert(await res.text());
      return;
    }

    if (path.includes("approve-device")) {
      setRows((prev) => prev.filter((row) => row.id !== payload.deviceId));
      return;
    }

    if (path.includes("reject-device")) {
      setRows((prev) => prev.filter((row) => row.id !== payload.deviceId));
      return;
    }

    await load();
  }

  function handleReject(deviceId: string, mac: string) {
    if (!confirm(`Reject device ${mac}?`)) return;
    void act("/api/admin/reject-device", { deviceId });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Pending device requests</h1>
      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-3">Student</th>
              <th className="p-3">Nama</th>
              <th className="p-3">Kelas</th>
              <th className="p-3">MAC</th>
              <th className="p-3">Hostname</th>
              <th className="p-3">Reason</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {busy && <tr><td colSpan={7} className="p-4 text-slate-500">Loading…</td></tr>}
            {!busy && rows.length === 0 && <tr><td colSpan={7} className="p-4 text-slate-500">No pending requests.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-3">
                  <Link href={`/admin/students/${r.student.id}`} className="font-mono text-slate-900 hover:text-blue-700 hover:underline">
                    {r.student.studentId}
                  </Link>
                  <span className="text-xs text-slate-500 ml-1">({r.student.status})</span>
                </td>
                <td className="p-3">{r.student.nama || "—"}</td>
                <td className="p-3">{r.student.kelas || "—"}</td>
                <td className="p-3 font-mono">{r.macAddress}</td>
                <td className="p-3">{r.hostname ?? "—"}</td>
                <td className="p-3">{r.reason ?? "—"}</td>
                <td className="p-3 space-x-2 whitespace-nowrap">
                  <button
                    onClick={() => act("/api/admin/approve-device", { deviceId: r.id })}
                    disabled={r.student.status !== "ACTIVE"}
                    title={r.student.status !== "ACTIVE" ? "Approve or re-approve the student first" : ""}
                    className="px-2 py-1 text-xs bg-green-600 text-white rounded disabled:opacity-40"
                  >{r.reason === "revoked-by-admin" ? "Re-approve" : "Approve"}</button>
                  {r.reason !== "revoked-by-admin" && (
                    <button onClick={() => handleReject(r.id, r.macAddress)}
                      className="px-2 py-1 text-xs bg-red-600 text-white rounded">Reject</button>
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
