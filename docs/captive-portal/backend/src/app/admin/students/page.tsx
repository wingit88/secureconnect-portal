"use client";
import { useEffect, useState } from "react";

type Device = {
  id: string;
  macAddress: string;
  approved: boolean;
  reason: string | null;
  syncState?: string;
  syncAttempts?: number;
  lastSyncError?: string | null;
};
type Student = {
  id: string;
  studentId: string;
  status: "PENDING" | "ACTIVE" | "DENIED";
  nama: string | null;
  kelas: string | null;
  speedLimitKbps: number | null;
  createdAt: string;
  devices: Device[];
};

export default function StudentsPage() {
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [speedInputs, setSpeedInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [savingStudentId, setSavingStudentId] = useState<string | null>(null);

  async function load() {
    setBusy(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status) params.set("status", status);
    const res = await fetch(`/api/admin/students?${params.toString()}`);
    const data = await res.json();
    setStudents(data.students);
    setSpeedInputs(Object.fromEntries(data.students.map((student: Student) => [student.studentId, student.speedLimitKbps?.toString() ?? ""])));
    setBusy(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function act(path: string, payload: object) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    load();
  }

  async function saveSpeedLimit(studentId: string) {
    const raw = speedInputs[studentId]?.trim() ?? "";
    const speed = raw === "" ? 0 : Number(raw);
    if (raw !== "" && (!Number.isFinite(speed) || speed < 0 || !Number.isInteger(speed))) {
      alert("Enter a valid non-negative whole number.");
      return;
    }
    setSavingStudentId(studentId);
    const res = await fetch("/api/admin/set-speed-limit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, speedLimitKbps: speed }),
    });
    setSavingStudentId(null);
    if (!res.ok) {
      alert(await res.text());
    } else {
      load();
    }
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

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">Student ID</th>
              <th className="p-3">Nama</th>
              <th className="p-3">Kelas</th>
              <th className="p-3">Speed limit</th>
              <th className="p-3">Status</th>
              <th className="p-3">Devices</th>
              <th className="p-3 w-0 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {busy && (
              <tr>
                <td colSpan={7} className="p-4 text-slate-500">Loading…</td>
              </tr>
            )}
            {!busy && students.length === 0 && (
              <tr>
                <td colSpan={7} className="p-4 text-slate-500">No students.</td>
              </tr>
            )}
            {students.map((s) => (
              <tr key={s.id} className="border-t border-slate-100 align-top">
                <td className="p-3 font-mono">
                  <a href={`/admin/students/${s.studentId}`} className="underline text-sky-600">{s.studentId}</a>
                </td>
                <td className="p-3">{s.nama ?? "—"}</td>
                <td className="p-3">{s.kelas ?? "—"}</td>
                <td className="p-3">
                  <div className="flex gap-2 items-center max-w-[220px]">
                    <input
                      className="w-24 px-2 py-1 border rounded"
                      type="number"
                      min={0}
                      step={1}
                      value={speedInputs[s.studentId] ?? ""}
                      onChange={(e) => setSpeedInputs({ ...speedInputs, [s.studentId]: e.target.value })}
                    />
                    <button
                      type="button"
                      onClick={() => saveSpeedLimit(s.studentId)}
                      disabled={savingStudentId === s.studentId}
                      className="px-2 py-1 text-xs bg-slate-900 text-white rounded disabled:opacity-50"
                    >
                      {savingStudentId === s.studentId ? "Saving…" : "Save"}
                    </button>
                  </div>
                </td>
                <td className="p-3">
                  <span className={
                    s.status === "ACTIVE"
                      ? "text-green-700"
                      : s.status === "DENIED"
                      ? "text-red-700"
                      : "text-amber-700"
                  }>{s.status}</span>
                </td>
                <td className="p-3">
                  {s.devices.length === 0 ? <span className="text-slate-400">none</span> : (
                    <ul className="space-y-1">
                      {s.devices.map((d) => (
                        <li key={d.id} className="font-mono text-xs">
                          {d.macAddress}{" "}
                          {d.approved ? "✓" : <em className="text-amber-600">pending</em>}
                          {d.approved ? (
                            <span
                              className={
                                d.syncState === "SYNCED"
                                  ? "text-green-700"
                                  : d.syncState === "SYNC_FAILED"
                                    ? "text-rose-700"
                                    : "text-amber-700"
                              }
                            >
                              {" "}
                              {d.syncState ?? "PENDING_SYNC"}
                            </span>
                          ) : null}
                          {d.reason && <span className="text-slate-500"> — {d.reason}</span>}
                          {d.approved && d.syncState === "SYNC_FAILED" && d.lastSyncError ? (
                            <span className="block text-[11px] text-rose-600 font-sans">
                              {d.lastSyncError}
                            </span>
                          ) : null}
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
                  <button onClick={() => confirm(`Delete ${s.studentId} and all bound devices?`) && act("/api/admin/delete-student", { studentId: s.studentId })} className="px-2 py-1 text-xs bg-rose-700 text-white rounded">Delete</button>
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