// Thin wrapper around node-routeros with automatic reconnect.
// All MAC inputs MUST already be normalized (lib/mac.ts).

import "@/lib/mikrotik-patch";
import { RouterOSAPI } from "node-routeros";

let conn: RouterOSAPI | null = null;
let connecting: Promise<RouterOSAPI> | null = null;
let patchApplied = false;

// Apply the !empty patch once when first needed
function applyEmptyPatch(): void {
  if (patchApplied) return;
  try {
    // @ts-ignore - require is available at runtime
    let mod: any;
    try {
      mod = require("node-routeros/dist/Channel");
    } catch (_) {
      try {
        const root = require("node-routeros");
        mod = root?.Channel || root?.default?.Channel || root?.dist?.Channel || root?.default;
      } catch (e) {
        mod = undefined;
      }
    }
    const Channel = mod?.default ?? mod;
    if (Channel && Channel.prototype) {
      const origOnUnknown = Channel.prototype.onUnknown;
      Channel.prototype.onUnknown = function (reply: string): void {
        try {
          if (reply === "!empty") {
            this.emit("done", []);
            this.close();
            return;
          }
        } catch (_e) {
          // ignore patch runtime errors
        }
        if (origOnUnknown) origOnUnknown.call(this, reply);
      };
    }
    patchApplied = true;
  } catch (e) {
    console.warn("Failed to apply node-routeros patch:", e);
  }
}

// Attempt to apply the patch eagerly at module load so Channel is patched
// before any RouterOS work happens (packagers/bundlers may load Channel early).
applyEmptyPatch();

function makeClient(): RouterOSAPI {
  return new RouterOSAPI({
    host: process.env.MIKROTIK_HOST!,
    port: Number(process.env.MIKROTIK_PORT ?? 8728),
    user: process.env.MIKROTIK_API_USER!,
    password: process.env.MIKROTIK_API_PASS!,
    timeout: 8,
    keepalive: true,
  });
}

async function getConn(): Promise<RouterOSAPI> {
  applyEmptyPatch();
  if (conn && conn.connected) return conn;
  if (connecting) return connecting;
  connecting = (async () => {
    const c = makeClient();
    await c.connect();
    c.on("close", () => { conn = null; });
    // Handle errors, suppressing !empty as it's a normal response
    c.on("error", (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("!empty")) {
        console.error("RouterOS connection error:", err);
      }
      try { c.close(); } catch {}
      conn = null;
    });
    conn = c;
    return c;
  })();
  try { return await connecting; } finally { connecting = null; }
}

function isEmptyReplyError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("UNKNOWNREPLY") && message.includes("!empty");
}

function isPrintCommand(words: string[]): boolean {
  return words[0]?.endsWith("/print") ?? false;
}

async function run(words: string[]): Promise<unknown[]> {
  const c = await getConn();
  try {
    return await c.write(words);
  } catch (err) {
    if (isPrintCommand(words) && isEmptyReplyError(err)) {
      return [];
    }
    // one retry on a fresh connection
    try { c.close(); } catch {}
    conn = null;
    const c2 = await getConn();
    try {
      return await c2.write(words);
    } catch (retryErr) {
      if (isPrintCommand(words) && isEmptyReplyError(retryErr)) {
        return [];
      }
      throw retryErr;
    }
  }
}

const profile = () => process.env.MIKROTIK_HOTSPOT_PROFILE ?? "student-profile";

/** Find an IP Binding by MAC. */
async function findIpBindingByMac(
  mac: string
): Promise<{ ".id": string } | null> {
  const res = (await run([
    "/ip/hotspot/ip-binding/print",
    `?mac-address=${mac}`,
  ])) as Array<Record<string, string>>;

  return res.length
    ? { ".id": res[0][".id"] }
    : null;
}

/** Find a Hotspot Host by MAC. */
async function findHostByMac(
  mac: string
): Promise<{ ".id": string } | null> {
  const res = (await run([
    "/ip/hotspot/host/print",
    `?mac-address=${mac}`,
  ])) as Array<Record<string, string>>;

  return res.length
    ? { ".id": res[0][".id"] }
    : null;
}

/**
 * Approve a device.
 *
 * Creates or updates an IP Binding of type=bypassed.
 * Afterward, removes the current Host entry so MikroTik
 * immediately re-evaluates the client.
 */
export async function approveDevice(
  studentId: string,
  mac: string
): Promise<void> {
  const existing = await findIpBindingByMac(mac);

  if (existing) {
    await run([
      "/ip/hotspot/ip-binding/set",
      `=.id=${existing[".id"]}`,
      "=type=bypassed",
      "=disabled=no",
      `=comment=${studentId}`,
    ]);
  } else {
    await run([
      "/ip/hotspot/ip-binding/add",
      `=mac-address=${mac}`,
      "=type=bypassed",
      `=comment=${studentId}`,
    ]);
  }

  // Force Hotspot to re-check this client.
  const host = await findHostByMac(mac);

  if (host) {
    await run([
      "/ip/hotspot/host/remove",
      `=.id=${host[".id"]}`,
    ]);
  }
}

/**
 * Revoke access.
 *
 * Removes the IP Binding so the next request
 * is redirected back to the captive portal.
 */
export async function revokeDevice(
  mac: string
): Promise<void> {
  const binding = await findIpBindingByMac(mac);

  if (binding) {
    await run([
      "/ip/hotspot/ip-binding/remove",
      `=.id=${binding[".id"]}`,
    ]);
  }

  const host = await findHostByMac(mac);

  if (host) {
    await run([
      "/ip/hotspot/host/remove",
      `=.id=${host[".id"]}`,
    ]);
  }
}

/**
 * Returns true if this MAC is already approved.
 */
export async function isDeviceApproved(
  mac: string
): Promise<boolean> {
  return (await findIpBindingByMac(mac)) !== null;
}

/**
 * List all approved devices.
 */
export async function listApprovedDevices() {
  return (await run([
    "/ip/hotspot/ip-binding/print",
  ])) as Array<Record<string, string>>;
}

/**
 * Remove every approved device belonging to a student.
 * Uses the comment field to identify ownership.
 */
export async function revokeAllDevicesForStudent(
  studentId: string
): Promise<void> {
  const bindings = (await run([
    "/ip/hotspot/ip-binding/print",
  ])) as Array<Record<string, string>>;

  for (const binding of bindings) {
    if (binding.comment === studentId) {
      await run([
        "/ip/hotspot/ip-binding/remove",
        `=.id=${binding[".id"]}`,
      ]);
    }
  }
}