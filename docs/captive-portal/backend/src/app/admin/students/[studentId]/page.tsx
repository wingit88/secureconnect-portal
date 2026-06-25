import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import ClientDeviceList from "./DeviceListClient";

type Params = { params: { studentId: string } };

export default async function StudentDetail({ params }: Params) {
  const s = await db.student.findUnique({ where: { studentId: params.studentId }, include: { devices: true } });
  if (!s) return notFound();

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Student {s.studentId}</h1>
      <div className="bg-white border rounded p-4">
        <p><strong>Nama:</strong> {s.nama ?? "—"}</p>
        <p><strong>Kelas:</strong> {s.kelas ?? "—"}</p>
        <p><strong>Status:</strong> {s.status}</p>
        <p><strong>Speed limit:</strong> {s.speedLimitKbps ?? "—"} kbps</p>
      </div>

      <div>
        <h2 className="text-lg font-medium">Devices</h2>
        <ClientDeviceList devices={s.devices} studentId={s.studentId} />
      </div>
    </div>
  );
}
