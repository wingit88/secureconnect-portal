export type PortalDeviceState = {
  approved: boolean;
  reason?: string | null;
} | null;

export function shouldBlockPortalAccess(studentStatus: string, device: PortalDeviceState): boolean {
  if (studentStatus === "DENIED") return true;
  if (!device) return false;
  return !device.approved && Boolean(device.reason);
}
