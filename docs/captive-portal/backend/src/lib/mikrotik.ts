// Thin wrapper around node-routeros with automatic reconnect.
// All MAC inputs MUST already be normalized (lib/mac.ts).

import { RouterOSAPI } from "node-routeros";

let conn: RouterOSAPI | null = null;
let connecting: Promise<RouterOSAPI> | null = null;
let patchApplied = false;

// Apply the !empty patch once when first needed
function applyEmptyPatch(): void {
  if (patchApplied) return;
  try {
    // @ts-ignore - require is available at runtime
    // Try a few ways to import the Channel class since packaging can vary.
    let mod: any;
    try {
      mod = require("node-routeros/dist/Channel");
    } catch (_) {
      try {
        // Fallback: import package root and look for Channel export
        const root = require("node-routeros");
        mod = root?.Channel || root?.default?.Channel || root?.dist?.Channel;
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

/** Find a /ip/hotspot/user by name. */
async function findUserByName(name: string): Promise<{ ".id": string } | null> {
  const res = (await run(["/ip/hotspot/user/print", `?name=${name}`])) as Array<Record<string, string>>;
  return res[0] ? ({ ".id": res[0][".id"] }) : null;
}

/** Find an active hotspot session by MAC. */
async function findActiveByMac(mac: string): Promise<{ ".id": string } | null> {
  const res = (await run(["/ip/hotspot/active/print", `?mac-address=${mac}`])) as Array<Record<string, string>>;
  return res[0] ? ({ ".id": res[0][".id"] }) : null;
}

/** Permanent MAC-authenticated hotspot user. Idempotent. */
export async function addHotspotUser(username: string, mac: string): Promise<void> {
  const existing = await findUserByName(username);
  if (existing) {
    await run([
      "/ip/hotspot/user/set",
      `=.id=${existing[".id"]}`,
      `=mac-address=${mac}`,
      `=profile=${profile()}`,
      `=password=`,
    ]);
    return;
  }
  await run([
    "/ip/hotspot/user/add",
    `=name=${username}`,
    `=mac-address=${mac}`,
    `=profile=${profile()}`,
    `=password=`,
    `=comment=captive-portal`,
  ]);
}

/** Remove the hotspot user by name. No-op if missing. */
export async function removeHotspotUserByName(username: string): Promise<void> {
  const u = await findUserByName(username);
  if (!u) return;
  await run(["/ip/hotspot/user/remove", `=.id=${u[".id"]}`]);
}

/** Immediately log a client into the hotspot. */
export async function loginUser(username: string, mac: string, ip: string): Promise<void> {
  await run([
    "/ip/hotspot/active/login",
    `=user=${username}`,
    `=password=`,
    `=mac-address=${mac}`,
    `=ip=${ip}`,
  ]);
}

/** Disconnect any active session for a given MAC. */
export async function disconnectByMac(mac: string): Promise<void> {
  const a = await findActiveByMac(mac);
  if (!a) return;
  await run(["/ip/hotspot/active/remove", `=.id=${a[".id"]}`]);
}

/** Find all hotspot users whose name starts with `prefix-` (per-student). */
export async function listHotspotUsersForStudent(studentId: string): Promise<string[]> {
  const res = (await run(["/ip/hotspot/user/print"])) as Array<Record<string, string>>;
  return res
    .filter((u) => u.name === studentId || (u.name && u.name.startsWith(`${studentId}#`)))
    .map((u) => u[".id"]);
}

export async function removeAllUsersForStudent(studentId: string): Promise<void> {
  const ids = await listHotspotUsersForStudent(studentId);
  for (const id of ids) {
    await run(["/ip/hotspot/user/remove", `=.id=${id}`]);
  }
}