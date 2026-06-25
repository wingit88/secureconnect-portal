import { db } from "@/lib/db";
import { listActiveSessions } from "@/lib/mikrotik";
import { normalize } from "@/lib/mac";

type Props = { searchParams?: { mac?: string } };

export default async function StatusPage({ searchParams }: Props) {
  const mac = searchParams?.mac?.trim();
  if (!mac) {
    return (
      <div className="p-6">
        <h1 className="text-xl font-semibold">Device Status</h1>
        <p className="mt-2 text-slate-600">Provide a device MAC as query parameter, for example <code className="font-mono">/status?mac=aa:bb:cc:dd:ee:ff</code></p>
      </div>
    );
  }

  const macNorm = normalize(mac);

  // Query RouterOS for active sessions and the database for student/device mapping.
  const [sessions, device] = await Promise.all([
    listActiveSessions(),
    db.device.findFirst({ where: { macAddress: macNorm }, include: { student: true } }),
  ]);

  const active = sessions.find((s) => normalize(s.macAddress) === macNorm);

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Device Status</h1>

      <div className="bg-white border rounded p-4">
        <p><strong>MAC:</strong> <span className="font-mono">{macNorm}</span></p>
        <p><strong>IP:</strong> {active?.address ?? "—"}</p>
        <p><strong>Uptime:</strong> {active?.uptime ?? "—"}</p>
      </div>

      <div className="bg-white border rounded p-4">
        <h2 className="text-lg font-medium">Student</h2>
        {device?.student ? (
          <div className="mt-2">
            <p><strong>Student ID:</strong> {device.student.studentId}</p>
            <p><strong>Nama:</strong> {device.student.nama ?? "—"}</p>
            <p><strong>Kelas:</strong> {device.student.kelas ?? "—"}</p>
            <p><strong>Status:</strong> {device.student.status}</p>
            <p><strong>Device approved:</strong> {device.approved ? "Yes" : "No"}</p>
          </div>
        ) : (
          <p className="text-slate-500 mt-2">No student or device record found for this MAC.</p>
        )}
      </div>
    </div>
  );
}
