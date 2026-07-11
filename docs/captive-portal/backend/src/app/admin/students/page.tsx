"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

function getStatusClass(status: Student["status"]) {
  if (status === "ACTIVE") return "text-green-700";
  if (status === "DENIED") return "text-red-700";
  return "text-amber-700";
}

type Device = { id: string; macAddress: string; hostname: string | null; approved: boolean; reason: string | null };
type Student = {
  id: string;
  studentId: string;
  nama: string;
  kelas: string;
  status: "PENDING" | "ACTIVE" | "DENIED";
  createdAt: string;
  devices: Device[];
};

type ActionPayload = {
  deviceId?: string;
  studentId?: string;
};

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

  async function act(path: string, payload: ActionPayload) {
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) {
      alert(await res.text());
      return;
    }

    const data = await res.json().catch(() => null);
    if (data?.ok) {
      setStudents((prev) => prev.map((student) => {
        if (student.studentId !== payload.studentId) return student;
        if (path.includes("approve-student")) {
          return { ...student, status: "ACTIVE" as const };
        }
        if (path.includes("deny-student") || path.includes("revoke")) {
          return { ...student, status: "DENIED" as const, devices: student.devices.map((device) => ({ ...device, approved: false, reason: "revoked-by-admin" })) };
        }
        return student;
      }));
      return;
    }

    await load();
  }

  function handleDelete(studentId: string) {
    if (!confirm(`Delete ${studentId} and all bound devices?`)) return;
    void act("/api/admin/delete-student", { studentId });
  }

  function handleRevoke(studentId: string) {
    if (!confirm(`Revoke ${studentId}?`)) return;
    void act("/api/admin/revoke", { studentId });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Students</h1>
      <div className="flex gap-2 items-end flex-wrap">
        <input className="px-3 py-2 border rounded-md" placeholder="Search ID, nama, or kelas" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="px-3 py-2 border rounded-md" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="ACTIVE">Active</option>
          <option value="DENIED">Denied</option>
        </select>
        <button onClick={load} className="px-4 py-2 bg-slate-900 text-white rounded-md">Search</button>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-3">Student ID</th>
              <th className="p-3">Nama</th>
              <th className="p-3">Kelas</th>
              <th className="p-3">Status</th>
              <th className="p-3">Devices</th>
              <th className="p-3 w-0 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {busy && <tr><td colSpan={6} className="p-4 text-slate-500">Loading…</td></tr>}
            {!busy && students.length === 0 && <tr><td colSpan={6} className="p-4 text-slate-500">No students.</td></tr>}
            {students.map((s) => {
              const approved = s.devices.filter((d) => d.approved).length;
              const pending = s.devices.length - approved;
              return (
                <tr key={s.id} className="border-t border-slate-100 align-top hover:bg-slate-50">
                  <td className="p-3">
                    <Link href={`/admin/students/${s.id}`} className="font-mono text-slate-900 hover:text-blue-700 hover:underline">
                      {s.studentId}
                    </Link>
                  </td>
                  <td className="p-3">{s.nama || <span className="text-slate-400">—</span>}</td>
                  <td className="p-3">{s.kelas || <span className="text-slate-400">—</span>}</td>
                  <td className="p-3"><span className={getStatusClass(s.status)}>{s.status}</span></td>
                  <td className="p-3">
                    {s.devices.length === 0 ? (
                      <span className="text-slate-400">none</span>
                    ) : (
                      <Link href={`/admin/students/${s.id}`} className="text-slate-700 hover:text-blue-700 hover:underline">
                        {s.devices.length} device{s.devices.length === 1 ? "" : "s"}
                        {pending > 0 && <span className="text-amber-600"> ({pending} pending)</span>}
                      </Link>
                    )}
                  </td>
                  <td className="p-3 space-x-2 whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {(s.status === "PENDING" || s.status === "DENIED") && (
                      <button
                        onClick={() => act("/api/admin/approve-student", { studentId: s.studentId })}
                        className="px-2 py-1 text-xs bg-green-600 text-white rounded"
                      >{s.status === "DENIED" ? "Re-approve" : "Approve"}</button>
                    )}
                    {s.status !== "DENIED" && s.status !== "PENDING" && (
                      <button onClick={() => handleRevoke(s.studentId)} className="px-2 py-1 text-xs bg-red-600 text-white rounded">Revoke</button>
                    )}
                    <button onClick={() => handleDelete(s.studentId)} className="px-2 py-1 text-xs bg-rose-700 text-white rounded">Delete</button>
                    {s.status === "PENDING" && (
                      <button onClick={() => act("/api/admin/deny-student", { studentId: s.studentId })} className="px-2 py-1 text-xs bg-slate-700 text-white rounded">Deny</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
