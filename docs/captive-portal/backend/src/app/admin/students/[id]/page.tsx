"use client";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Device = {
  id: string;
  macAddress: string;
  hostname: string | null;
  approved: boolean;
  reason: string | null;
  createdAt: string;
};

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

function deviceStatus(d: Device, studentStatus: Student["status"]): { label: string; className: string } {
  if (d.approved) return { label: "Approved", className: "text-green-700" };
  if (d.reason === "revoked-by-admin") return { label: "Revoked", className: "text-red-700" };
  if (d.reason === "denied-by-admin") return { label: "Denied", className: "text-red-700" };
  if (studentStatus === "DENIED") return { label: "Denied", className: "text-red-600" };
  return { label: "Pending", className: "text-amber-700" };
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [student, setStudent] = useState<Student | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editValues, setEditValues] = useState({ studentId: "", nama: "", kelas: "" });

  const load = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/students/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (!res.ok) {
      setError(res.status === 404 ? "Student not found." : await res.text());
      setStudent(null);
      setBusy(false);
      return;
    }
    const data = await res.json();
    setStudent(data.student);
    setBusy(false);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    void load();
  }, [id, load]);

  useEffect(() => {
    if (!student) return;
    setEditValues({
      studentId: student.studentId,
      nama: student.nama,
      kelas: student.kelas,
    });
  }, [student]);

  async function act(path: string, payload: ActionPayload, opts?: { redirect?: string }) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    if (opts?.redirect) {
      router.push(opts.redirect);
      return;
    }
    await load();
  }

  async function handleSaveDetails() {
    if (!student) return;
    setSaving(true);
    setError(null);

    const res = await fetch(`/api/admin/students/${encodeURIComponent(student.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editValues),
    });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      setError(data?.message ?? "Unable to update student details.");
      setSaving(false);
      return;
    }

    setStudent((prev) => prev ? { ...prev, ...data.student } : prev);
    setEditMode(false);
    setSaving(false);
  }

  if (!id) {
    return <p className="text-slate-500">Loading…</p>;
  }

  if (busy && !student) {
    return <p className="text-slate-500">Loading…</p>;
  }

  if (error || !student) {
    return (
      <div className="space-y-4">
        <Link href="/admin/students" className="text-sm text-slate-600 hover:text-slate-900">← Back to students</Link>
        <p className="text-red-600">{error ?? "Student not found."}</p>
      </div>
    );
  }

  const approvedCount = student.devices.filter((d) => d.approved).length;
  const pendingCount = student.devices.length - approvedCount;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/students" className="text-sm text-slate-600 hover:text-slate-900">← Back to students</Link>
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold font-mono">{student.nama}</h1>
            <p className="text-sm text-slate-700 mt-1">
              {student.studentId || "—"} · {student.kelas || "—"}
            </p>
            <p className="text-sm text-slate-500 mt-1">
              Registered {new Date(student.createdAt).toLocaleString()}
            </p>
          </div>
          <span className={
            student.status === "ACTIVE" ? "text-green-700 font-medium" :
            student.status === "DENIED" ? "text-red-700 font-medium" :
            "text-amber-700 font-medium"
          }>{student.status}</span>
        </div>

        <p className="text-sm text-slate-600">
          {student.devices.length === 0
            ? "No devices registered."
            : `${approvedCount} approved, ${pendingCount} not approved`}
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          {student.status === "ACTIVE" && !editMode && (
            <button
              onClick={() => setEditMode(true)}
              className="px-3 py-1.5 text-sm bg-slate-700 text-white rounded-md"
            >Edit details</button>
          )}
          {student.status === "PENDING" && (
            <>
              <button
                onClick={() => act("/api/admin/approve-student", { studentId: student.studentId })}
                className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md"
              >Approve student</button>
              <button
                onClick={() => act("/api/admin/deny-student", { studentId: student.studentId })}
                className="px-3 py-1.5 text-sm bg-slate-700 text-white rounded-md"
              >Deny student</button>
            </>
          )}
          {student.status === "DENIED" && (
            <button
              onClick={() => act("/api/admin/approve-student", { studentId: student.studentId })}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md"
            >Re-approve student</button>
          )}
          {student.status === "ACTIVE" && (
            <button
              onClick={() => {
                if (!confirm(`Revoke access for ${student.studentId}?`)) return;
                act("/api/admin/revoke", { studentId: student.studentId });
              }}
              className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-md"
            >Revoke student</button>
          )}
          <button
            onClick={() => {
              if (!confirm(`Delete ${student.studentId} and all devices permanently?`)) return;
              act("/api/admin/delete-student", { studentId: student.studentId }, { redirect: "/admin/students" });
            }}
            className="px-3 py-1.5 text-sm bg-rose-700 text-white rounded-md"
          >Delete student</button>
        </div>
      </div>

      {student.status === "ACTIVE" && editMode && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-medium">Edit student details</h2>
            <button onClick={() => setEditMode(false)} className="text-sm text-slate-600 hover:text-slate-900">Cancel</button>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm text-slate-700">
              <span className="mb-1 block">Student ID</span>
              <input
                value={editValues.studentId}
                onChange={(e) => setEditValues((prev) => ({ ...prev, studentId: e.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block">Nama</span>
              <input
                value={editValues.nama}
                onChange={(e) => setEditValues((prev) => ({ ...prev, nama: e.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
            <label className="text-sm text-slate-700">
              <span className="mb-1 block">Kelas</span>
              <input
                value={editValues.kelas}
                onChange={(e) => setEditValues((prev) => ({ ...prev, kelas: e.target.value }))}
                className="w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSaveDetails}
              disabled={saving}
              className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md disabled:opacity-50"
            >{saving ? "Saving…" : "Save changes"}</button>
            <button onClick={() => setEditMode(false)} className="px-3 py-1.5 text-sm border border-slate-300 rounded-md">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <h2 className="font-medium">Devices</h2>
        </div>
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-slate-50 text-left border-b border-slate-100">
            <tr>
              <th className="p-3">MAC address</th>
              <th className="p-3">Hostname</th>
              <th className="p-3">Status</th>
              <th className="p-3">Reason</th>
              <th className="p-3">Registered</th>
              <th className="p-3 w-0 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody>
            {student.devices.length === 0 && (
              <tr><td colSpan={6} className="p-4 text-slate-500">No devices yet.</td></tr>
            )}
            {student.devices.map((d) => {
              const status = deviceStatus(d, student.status);
              const canApprove = student.status === "ACTIVE";
              return (
                <tr key={d.id} className="border-t border-slate-100 align-top">
                  <td className="p-3 font-mono">{d.macAddress}</td>
                  <td className="p-3 text-slate-700">{d.hostname ?? <span className="text-slate-400">—</span>}</td>
                  <td className="p-3"><span className={status.className}>{status.label}</span></td>
                  <td className="p-3 text-slate-600">{d.reason ?? "—"}</td>
                  <td className="p-3 text-slate-500">{new Date(d.createdAt).toLocaleString()}</td>
                  <td className="p-3 space-x-2 whitespace-nowrap">
                    {!d.approved && (
                      <>
                        <button
                          onClick={() => act("/api/admin/approve-device", { deviceId: d.id })}
                          disabled={!canApprove}
                          title={!canApprove ? "Re-approve the student first" : d.reason === "revoked-by-admin" ? "Re-approve device" : "Approve device"}
                          className="px-2 py-1 text-xs bg-green-600 text-white rounded disabled:opacity-40"
                        >{d.reason === "revoked-by-admin" ? "Re-approve" : "Approve"}</button>
                        {!d.reason?.includes("revoked") && (
                          <button
                            onClick={() => {
                              if (!confirm(`Reject device ${d.macAddress}?`)) return;
                              act("/api/admin/reject-device", { deviceId: d.id });
                            }}
                            className="px-2 py-1 text-xs bg-red-600 text-white rounded"
                          >Reject</button>
                        )}
                      </>
                    )}
                    {d.approved && (
                      <button
                        onClick={() => {
                          if (!confirm(`Revoke access for ${d.macAddress}?`)) return;
                          act("/api/admin/revoke-device", { deviceId: d.id });
                        }}
                        className="px-2 py-1 text-xs bg-red-600 text-white rounded"
                      >Revoke</button>
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
