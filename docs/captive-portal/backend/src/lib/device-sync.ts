import { db } from "@/lib/db";
import { normalize } from "@/lib/mac";
import { isMikrotikConfigured, readHostnameByMac } from "@/lib/mikrotik";

/** Fetch hostname from MikroTik and persist on the Device row. */
export async function refreshDeviceHostname(
  macAddress: string,
  deviceId?: string,
): Promise<string | null> {
  if (!isMikrotikConfigured()) return null;

  const mac = normalize(macAddress);
  let hostname: string | null = null;
  try {
    hostname = await readHostnameByMac(mac);
  } catch (err) {
    console.warn("[device-sync] hostname lookup failed for", mac, err);
    return null;
  }

  if (hostname) {
    await db.device.update({
      where: deviceId ? { id: deviceId } : { macAddress: mac },
      data: { hostname },
    });
  }

  return hostname;
}

/** Refresh hostnames for many devices (best-effort, parallel). */
export async function refreshDeviceHostnames(
  devices: Array<{ id: string; macAddress: string }>,
): Promise<void> {
  await Promise.allSettled(
    devices.map((d) => refreshDeviceHostname(d.macAddress, d.id)),
  );
}
