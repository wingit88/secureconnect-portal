import { db } from "@/lib/db";
import { normalize } from "@/lib/mac";
import {
  clearHotspotHosts,
  revokeAllDevicesForStudent,
  revokeDevice,
} from "@/lib/mikrotik";

type StudentWithDevices = {
  id: string;
  studentId: string;
  devices: Array<{ id: string; macAddress: string }>;
};

/** Mark every device for this student as revoked/denied in the database. */
export async function markAllDevicesRevokedInDb(
  studentInternalId: string,
  reason: "revoked-by-admin" | "denied-by-admin",
): Promise<number> {
  const result = await db.device.updateMany({
    where: { studentId: studentInternalId },
    data: { approved: false, reason },
  });
  return result.count;
}

/**
 * Remove MikroTik bindings (by student comment) and hotspot host rows per MAC.
 * Uses two batched operations instead of redundant per-device binding lookups.
 */
export async function revokeAllDevicesOnRouter(
  routerStudentId: string,
  macAddresses: string[],
): Promise<void> {
  const macs = macAddresses.map((m) => normalize(m));
  try {
    await revokeAllDevicesForStudent(routerStudentId);
  } catch (err) {
    console.warn("[student-cleanup] comment-based binding removal failed", err);
  }
  try {
    await clearHotspotHosts(macs);
  } catch (err) {
    console.warn("[student-cleanup] host cleanup failed", err);
  }
}

/** Fire-and-forget router cleanup so admin API responses stay fast. */
export function scheduleRevokeAllDevicesOnRouter(
  routerStudentId: string,
  macAddresses: string[],
): void {
  void revokeAllDevicesOnRouter(routerStudentId, macAddresses).catch((err) => {
    console.error("[student-cleanup] router revoke failed for", routerStudentId, err);
  });
}

/** Revoke every device in DB and on MikroTik for a student. */
export async function revokeAllStudentDevices(
  student: StudentWithDevices,
  reason: "revoked-by-admin" | "denied-by-admin",
): Promise<{ devicesRevoked: number }> {
  const devicesRevoked = await markAllDevicesRevokedInDb(student.id, reason);
  scheduleRevokeAllDevicesOnRouter(
    student.studentId,
    student.devices.map((d) => d.macAddress),
  );
  return { devicesRevoked };
}

/** Delete all device rows, then the student. Router bindings are cleared in the background. */
export async function deleteStudentAndDevices(
  student: StudentWithDevices,
): Promise<{ devicesDeleted: number }> {
  const devicesDeleted = student.devices.length;
  const macs = student.devices.map((d) => d.macAddress);
  const routerStudentId = student.studentId;

  await db.device.deleteMany({ where: { studentId: student.id } });
  await db.student.delete({ where: { id: student.id } });

  scheduleRevokeAllDevicesOnRouter(routerStudentId, macs);

  return { devicesDeleted };
}

/** Revoke a single device on MikroTik (awaited — use from device revoke route). */
export async function revokeSingleDeviceOnRouter(macAddress: string): Promise<void> {
  await revokeDevice(normalize(macAddress));
}
