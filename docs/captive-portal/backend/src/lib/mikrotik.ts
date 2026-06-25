// Thin wrapper around node-routeros with automatic reconnect.
// All MAC inputs MUST already be normalized (lib/mac.ts).

import "@/lib/mikrotik-patch";
import { RouterOSAPI } from "node-routeros";

let conn: RouterOSAPI | null = null;
let connecting: Promise<RouterOSAPI> | null = null;
let patchApplied = false;
let writeQueue: Promise<unknown> = Promise.resolve();
const RETRYABLE_ERROR_CODES = ["SOCKTMOUT", "ECONNRESET", "EPIPE", "ETIMEDOUT", "UNREGISTEREDTAG"];
const MAX_ATTEMPTS = 3;

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
    timeout: 15,
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
    // Log and allow next command to reconnect if needed.
    c.on("error", (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("!empty")) {
        console.error("RouterOS connection error:", err);
      }
    });
    conn = c;
    return c;
  })();
  try { return await connecting; } finally { connecting = null; }
}

function buildRateLimitArg(speedLimitKbps?: number): string | undefined {
  if (!speedLimitKbps || speedLimitKbps <= 0) return undefined;
  return `=rate-limit=${speedLimitKbps}k/${speedLimitKbps}k`;
}

export type ActiveSession = {
  id: string;
  user: string;
  macAddress: string;
  address?: string;
  uptime?: string;
};

export async function listActiveSessions(): Promise<ActiveSession[]> {
  const res = (await run(["/ip/hotspot/active/print"])) as Array<Record<string, string>>;
  return res.map((row) => ({
    id: row[".id"] ?? "",
    user: row.user ?? "",
    macAddress: row["mac-address"] ?? "",
    address: row.address,
    uptime: row.uptime,
  }));
}

function isEmptyReplyError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (!lower.includes("!empty")) return false;
  return (
    lower.includes("unknownreply") ||
    lower.includes("unknown reply") ||
    lower.includes("tried to process") ||
    lower.includes("no data")
  );
}

function isPrintCommand(words: string[]): boolean {
  return words[0]?.endsWith("/print") ?? false;
}

async function run(words: string[]): Promise<unknown[]> {
  const execute = async (): Promise<unknown[]> => runWithRetry(words);

  // RouterOS API library gets unstable under concurrent writes on one socket.
  // Serialize all commands through a single queue.
  const runPromise = writeQueue.then(execute, execute);
  writeQueue = runPromise.then(() => undefined, () => undefined);
  return runPromise;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyRouterError(err: unknown): { retryable: boolean; code: string } {
  const msg = err instanceof Error ? err.message : String(err);
  const anyErr = err as { errno?: string; code?: string } | undefined;
  const code = String(anyErr?.errno ?? anyErr?.code ?? "");
  const upper = `${code} ${msg}`.toUpperCase();
  const retryable = RETRYABLE_ERROR_CODES.some((c) => upper.includes(c));
  return { retryable, code: code || "UNKNOWN" };
}

async function writeOnce(words: string[]): Promise<unknown[]> {
  const c = await getConn();
  return c.write(words);
}

async function runWithRetry(words: string[]): Promise<unknown[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await writeOnce(words);
    } catch (err) {
      if (isPrintCommand(words) && isEmptyReplyError(err)) {
        return [];
      }
      lastErr = err;
      const { retryable } = classifyRouterError(err);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      try { conn?.close(); } catch {}
      conn = null;
      const backoffMs = 200 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 120);
      await wait(backoffMs);
    }
  }
  throw lastErr;
}

const profile = () => process.env.MIKROTIK_HOTSPOT_PROFILE ?? "student-profile";

/** Find a /ip/hotspot/user by name. */
async function findUserByName(name: string): Promise<{ ".id": string } | null> {
  const res = (await run(["/ip/hotspot/user/print", `?name=${name}`])) as Array<Record<string, string>>;
  return res[0] ? ({ ".id": res[0][".id"] }) : null;
}

/** Find a /ip/hotspot/user by MAC address. */
async function findUserByMac(mac: string): Promise<{ ".id": string, name?: string } | null> {
  const res = (await run(["/ip/hotspot/user/print", `?mac-address=${mac}`])) as Array<Record<string, string>>;
  if (!res[0]) return null;
  return { ".id": res[0][".id"], name: res[0].name };
}

export async function getHotspotUsernameByMac(mac: string): Promise<string | null> {
  const user = await findUserByMac(mac);
  return user?.name ?? null;
}

/** Find an active hotspot session by MAC. */
async function findActiveByMac(mac: string): Promise<{ ".id": string } | null> {
  const res = (await run(["/ip/hotspot/active/print", `?mac-address=${mac}`])) as Array<Record<string, string>>;
  return res[0] ? ({ ".id": res[0][".id"] }) : null;
}

/** Permanent MAC-authenticated hotspot user. Idempotent. */
export async function addHotspotUser(username: string, mac: string, speedLimitKbps?: number): Promise<void> {
  const existing = await findUserByName(username);
  const rateLimitArg = buildRateLimitArg(speedLimitKbps);
  if (existing) {
    const args = [
      "/ip/hotspot/user/set",
      `=.id=${existing[".id"]}`,
      `=mac-address=${mac}`,
      `=profile=${profile()}`,
      `=password=`,
    ];
    if (rateLimitArg) args.push(rateLimitArg);
    await run(args);
    return;
  }
  const args = [
    "/ip/hotspot/user/add",
    `=name=${username}`,
    `=mac-address=${mac}`,
    `=profile=${profile()}`,
    `=password=`,
    `=comment=captive-portal`,
  ];
  if (rateLimitArg) args.push(rateLimitArg);
  await run(args);
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

/** Best-effort client IP lookup before tearing down an active hotspot session. */
export async function resolveClientIpByMac(mac: string): Promise<string | null> {
  const active = (await run(["/ip/hotspot/active/print", `?mac-address=${mac}`])) as Array<Record<string, string>>;
  if (active[0]?.address) return active[0].address;

  const leases = (await run(["/ip/dhcp-server/lease/print", `?mac-address=${mac}`])) as Array<Record<string, string>>;
  const bound = leases.find((row) => row.address && row.status !== "expired");
  if (bound?.address) return bound.address;

  const arp = (await run(["/ip/arp/print", `?mac-address=${mac}`])) as Array<Record<string, string>>;
  if (arp[0]?.address) return arp[0].address;

  return null;
}

/**
 * Add a static MAC user, clear any stale unauthenticated session, and log the
 * client in when we can resolve its IP. Required after admin approval — adding
 * the user alone leaves existing captive sessions walled off.
 */
export async function provisionHotspotAccess(
  username: string,
  mac: string,
  speedLimitKbps?: number,
): Promise<void> {
  const ip = await resolveClientIpByMac(mac);
  await addHotspotUser(username, mac, speedLimitKbps);
  await disconnectByMac(mac);
  if (ip) {
    await loginUser(username, mac, ip);
  }
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

/** Remove a hotspot user entry by MAC address if present. */
export async function removeHotspotUserByMac(mac: string): Promise<void> {
  const u = await findUserByMac(mac);
  if (!u) return;
  await run(["/ip/hotspot/user/remove", `=.id=${u[".id"]}`]);
}

type UrlFilterMode = "disabled" | "blacklist" | "whitelist";

export type UrlFilterConfig = {
  urlFilterMode: UrlFilterMode;
  urlBlacklist: string[];
  urlWhitelist: string[];
};

const FILTER_COMMENT = "captive-portal-url-filter";
const HOTSPOT_VLAN_INTERFACE = process.env.MIKROTIK_HOTSPOT_INTERFACE ?? "vlan30-students";

async function cleanupUrlFilterRules(): Promise<void> {
  const rules = (await run(["/ip/firewall/filter/print", `?comment=${FILTER_COMMENT}`])) as Array<Record<string, string>>;
  for (const rule of rules) {
    if (rule[".id"]) {
      await run(["/ip/firewall/filter/remove", `=.id=${rule[".id"]}`]);
    }
  }
}

function buildFilterArgs(entry: string, action: "drop" | "accept") {
  const args = [
    "/ip/firewall/filter/add",
    "=chain=forward",
    `=in-interface=${HOTSPOT_VLAN_INTERFACE}`,
    "=protocol=tcp",
    "=dst-port=80,443",
    `=dst-host=${entry}`,
    `=action=${action}`,
    `=comment=${FILTER_COMMENT}`,
  ];
  return args;
}

export async function syncUrlFilter(config: UrlFilterConfig): Promise<void> {
  await cleanupUrlFilterRules();

  if (config.urlFilterMode === "disabled") {
    return;
  }

  if (config.urlFilterMode === "blacklist") {
    for (const entry of config.urlBlacklist) {
      if (!entry) continue;
      await run(buildFilterArgs(entry, "drop"));
    }
    return;
  }

  if (config.urlFilterMode === "whitelist") {
    for (const entry of config.urlWhitelist) {
      if (!entry) continue;
      await run(buildFilterArgs(entry, "accept"));
    }
    await run([
      "/ip/firewall/filter/add",
      "=chain=forward",
      `=in-interface=${HOTSPOT_VLAN_INTERFACE}`,
      "=protocol=tcp",
      "=dst-port=80,443",
      "=action=drop",
      `=comment=${FILTER_COMMENT}`,
    ]);
  }
}