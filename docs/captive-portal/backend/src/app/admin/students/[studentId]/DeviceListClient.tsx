"use client";
import { useState } from "react";

export default function ClientDeviceList({ devices, studentId }: { devices: Array<{ id: string; macAddress: string; approved: boolean; reason: string | null }>; studentId: string }) {
  const [busy, setBusy] = useState(false);
  async function doAction(path: string, payload: object) {
    setBusy(true);
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(false);
    if (!res.ok) {
      alert(await res.text());
      return;
    }
    // reload current page
    window.location.reload();
  }

  return (
    <div className="bg-white border rounded overflow-x-auto mt-2">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="p-3">MAC</th>
            <th className="p-3">Approved</th>
            <th className="p-3">Reason</th>
            <th className="p-3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="p-3 font-mono">{d.macAddress}</td>
              <td className="p-3">{d.approved ? "Yes" : "No"}</td>
              <td className="p-3">{d.reason ?? "—"}</td>
              <td className="p-3 space-x-2">
                {!d.approved && (
                  <button onClick={() => doAction("/api/admin/approve-device", { deviceId: d.id })} disabled={busy} className="px-2 py-1 bg-green-600 text-white rounded text-xs">Approve</button>
                )}
                {d.approved && (
                  <button onClick={() => confirm(`Revoke device ${d.macAddress}?`) && doAction("/api/admin/revoke-device", { deviceId: d.id })} disabled={busy} className="px-2 py-1 bg-amber-600 text-white rounded text-xs">Revoke</button>
                )}
                <button onClick={() => confirm(`Delete device ${d.macAddress}?`) && doAction("/api/admin/reject-device", { deviceId: d.id })} disabled={busy} className="px-2 py-1 bg-red-600 text-white rounded text-xs">Delete</button>
              </td>
            </tr>
          ))}
          {devices.length === 0 && (
            <tr><td colSpan={4} className="p-4 text-slate-500">No devices</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
