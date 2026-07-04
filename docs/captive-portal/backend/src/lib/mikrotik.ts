// MikroTik RouterOS API wrapper built on node-routeros.
// - Serial command queue (one channel at a time — avoids stuck multi-channel states)
// - Per-command timeouts with forced connection reset on expiry
// - Automatic reconnect + limited retries
// - Circuit breaker when the router is unreachable
// All MAC inputs MUST already be normalized (lib/mac.ts).

import "@/lib/mikrotik-patch";
import { RouterOSAPI } from "node-routeros";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const COMMAND_TIMEOUT_MS = envInt("MIKROTIK_COMMAND_TIMEOUT_MS", 20_000);
const CONNECT_TIMEOUT_MS = envInt("MIKROTIK_CONNECT_TIMEOUT_MS", 10_000);
const MAX_RETRIES = envInt("MIKROTIK_MAX_RETRIES", 2);
const SOCKET_TIMEOUT_SEC = Math.max(
  envInt("MIKROTIK_SOCKET_TIMEOUT_SEC", 30),
  Math.ceil((COMMAND_TIMEOUT_MS + 3_000) / 1_000),
);
const CIRCUIT_THRESHOLD = envInt("MIKROTIK_CIRCUIT_THRESHOLD", 5);
const CIRCUIT_COOLDOWN_MS = envInt("MIKROTIK_CIRCUIT_COOLDOWN_MS", 30_000);

export function isMikrotikConfigured(): boolean {
  return Boolean(
    process.env.MIKROTIK_HOST &&
    process.env.MIKROTIK_API_USER &&
    process.env.MIKROTIK_API_PASS,
  );
}

// ---------------------------------------------------------------------------
// Connection pool (single persistent client)
// ---------------------------------------------------------------------------

let conn: RouterOSAPI | null = null;
let connectPromise: Promise<RouterOSAPI> | null = null;
let consecutiveFailures = 0;
let circuitOpenUntil = 0;
const REUSE_CONNECTION = process.env.MIKROTIK_REUSE_CONNECTION === "1";
const FORCE_RECONNECT_EACH_COMMAND = process.env.MIKROTIK_FORCE_RECONNECT_EACH_COMMAND !== "0";

function makeClient(): RouterOSAPI {
  return new RouterOSAPI({
    host: process.env.MIKROTIK_HOST!,
    port: Number(process.env.MIKROTIK_PORT ?? 8728),
    user: process.env.MIKROTIK_API_USER!,
    password: process.env.MIKROTIK_API_PASS!,
    timeout: SOCKET_TIMEOUT_SEC,
    // Library keepalive opens extra channels outside our queue and can deadlock
    // under concurrent API traffic. TCP keepalive is enabled by node-routeros;
    // stale sockets are detected via command timeouts + reconnect.
    keepalive: false,
  });
}

function resetConnection(): void {
  if (conn) {
    try { conn.close(); } catch { /* ignore */ }
  }
  conn = null;
  connectPromise = null;
}

function setupClientHandlers(c: RouterOSAPI): void {
  c.removeAllListeners("close");
  c.removeAllListeners("error");

  c.on("close", () => {
    if (conn === c) conn = null;
  });

  c.on("error", (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("!empty")) {
      console.error("[mikrotik] connection error:", err);
    }
    try { c.close(); } catch { /* ignore */ }
    if (conn === c) conn = null;
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`RouterOS ${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function checkCircuit(): void {
  if (!isMikrotikConfigured()) {
    throw new Error("MikroTik API is not configured (check MIKROTIK_* env vars)");
  }
  if (Date.now() < circuitOpenUntil) {
    throw new Error("RouterOS temporarily unavailable (circuit breaker open)");
  }
}

function recordSuccess(): void {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

function recordFailure(): void {
  consecutiveFailures += 1;
  resetConnection();
  if (consecutiveFailures >= CIRCUIT_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    console.error(
      `[mikrotik] circuit breaker open for ${CIRCUIT_COOLDOWN_MS}ms after ${consecutiveFailures} failures`,
    );
  }
}

async function createConnection(): Promise<RouterOSAPI> {
  const c = makeClient();
  setupClientHandlers(c);
  await withTimeout(c.connect(), CONNECT_TIMEOUT_MS, "connect");
  conn = c;
  return c;
}

async function getConn(): Promise<RouterOSAPI> {
  if (conn) {
    const connected = Boolean((conn as unknown as { connected?: boolean }).connected);
    if (connected) return conn;
    resetConnection();
  }

  if (!connectPromise) {
    connectPromise = createConnection().finally(() => {
      connectPromise = null;
    });
  }

  return withTimeout(connectPromise, CONNECT_TIMEOUT_MS + 2_000, "connect wait");
}

// ---------------------------------------------------------------------------
// Serial command queue — node-routeros opens one channel per write(); under
// concurrent load channels can leave the socket in a bad state. Serialize all
// RouterOS work so commands never overlap.
// ---------------------------------------------------------------------------

type QueueEntry<T> = {
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

const queue: QueueEntry<unknown>[] = [];
let draining = false;

function enqueue<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ run, resolve: resolve as (v: unknown) => void, reject });
    void drainQueue();
  });
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const entry = queue.shift()!;
    try {
      entry.resolve(await entry.run());
    } catch (err) {
      entry.reject(err);
    }
  }
  draining = false;
}

// ---------------------------------------------------------------------------
// Low-level command runner
// ---------------------------------------------------------------------------

function isEmptyReplyError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("UNKNOWNREPLY") && message.includes("!empty");
}

function isBenignCommandError(err: unknown, words: string[]): boolean {
  if (isEmptyReplyError(err)) return true;
  const cmd = words[0] ?? "";
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  if (lower.includes("already have") || lower.includes("already exists") || lower.includes("already logged in")) {
    return true;
  }
  if (lower.includes("failure") && (lower.includes("name") || lower.includes("ip "))) {
    return true;
  }
  // remove/set on a missing .id is not fatal for our idempotent flows
  if (cmd.endsWith("/remove") && lower.includes("no such item")) return true;
  if (cmd.endsWith("/remove") && lower.includes("invalid value")) return true;
  return false;
}

function isRetryableTransportError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  const lower = message.toLowerCase();
  return [
    "unregisteredtag",
    "econnreset",
    "econnrefused",
    "etimedout",
    "socket hang up",
    "socket closed",
    "timed out",
    "connect",
    "unknownreply",
    "broken pipe",
  ].some((token) => lower.includes(token));
}

function formatCommand(words: string[]): string {
  return words[0] ?? "unknown";
}

async function runOnce(words: string[]): Promise<unknown[]> {
  if (!REUSE_CONNECTION || FORCE_RECONNECT_EACH_COMMAND) {
    const c = makeClient();
    setupClientHandlers(c);
    try {
      await withTimeout(c.connect(), CONNECT_TIMEOUT_MS, "connect");
      const result = await withTimeout(
        c.write(words) as Promise<unknown[]>,
        COMMAND_TIMEOUT_MS,
        formatCommand(words),
      );
      return result;
    } finally {
      try { c.close(); } catch { /* ignore */ }
    }
  }

  const c = await getConn();
  const result = await withTimeout(
    c.write(words) as Promise<unknown[]>,
    COMMAND_TIMEOUT_MS,
    formatCommand(words),
  );
  return result;
}

async function runInternal(words: string[]): Promise<unknown[]> {
  checkCircuit();

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await runOnce(words);
      recordSuccess();
      return result;
    } catch (err) {
      lastError = err;

      if (isBenignCommandError(err, words)) {
        recordSuccess();
        return [];
      }

      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[mikrotik] ${formatCommand(words)} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        message,
      );

      if (isRetryableTransportError(err)) {
        resetConnection();
      }

      if (attempt < MAX_RETRIES) {
        // brief pause before retry so the router can accept a new socket
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }

      if (message.includes("UNREGISTEREDTAG") || message.includes("UNKNOWNREPLY")) {
        try {
          await runOnce(["/system/identity/print"]);
        } catch {
          // best effort probe
        }
      }
    }
  }

  recordFailure();
  throw lastError;
}

async function run(words: string[]): Promise<unknown[]> {
  return enqueue(() => runInternal(words));
}

// ---------------------------------------------------------------------------
// Hotspot helpers
// ---------------------------------------------------------------------------

const HOTSPOT_USER_PROFILE = process.env.MIKROTIK_HOTSPOT_USER_PROFILE?.trim() || "";

function buildHotspotUserSetWords(
  id: string,
  studentId: string,
  mac: string,
): string[] {
  const words = [
    "/ip/hotspot/user/set",
    `=.id=${id}`,
    `=name=${mac}`,
    `=password=${mac}`,
    `=comment=${studentId}`,
    `=mac-address=${mac}`,
    "=disabled=no",
  ];
  if (HOTSPOT_USER_PROFILE) words.push(`=profile=${HOTSPOT_USER_PROFILE}`);
  return words;
}

function buildHotspotUserAddWords(studentId: string, mac: string): string[] {
  const words = [
    "/ip/hotspot/user/add",
    `=name=${mac}`,
    `=password=${mac}`,
    `=comment=${studentId}`,
    `=mac-address=${mac}`,
    "=disabled=no",
  ];
  if (HOTSPOT_USER_PROFILE) words.push(`=profile=${HOTSPOT_USER_PROFILE}`);
  return words;
}

function isDuplicateHotspotUserError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("already have")
    || message.includes("already exists")
    || message.includes("failure") && message.includes("name")
  );
}

async function upsertHotspotUser(studentId: string, mac: string): Promise<void> {
  try {
    await run(buildHotspotUserAddWords(studentId, mac));
    return;
  } catch (err) {
    if (isDuplicateHotspotUserError(err)) {
      // Existing user is acceptable for idempotent approve operations.
      return;
    }
    throw err;
  }
}

/** Find a Hotspot User by MAC (username is MAC for MAC auth). */
async function findHotspotUserByMac(
  mac: string,
): Promise<Record<string, string> | null> {
  const res = (await run([
    "/ip/hotspot/user/print",
    `?name=${mac}`,
  ])) as Array<Record<string, string>>;

  if (res.length) return res[0];

  const all = (await run([
    "/ip/hotspot/user/print",
  ])) as Array<Record<string, string>>;

  const needle = normalizeMacKey(mac);
  return all.find((row) => {
    const byName = normalizeMacKey(row.name ?? "");
    const byMac = normalizeMacKey(row["mac-address"] ?? "");
    return byName === needle || byMac === needle;
  }) ?? null;
}

/** Find a Hotspot Host by MAC. */
async function findHostByMac(
  mac: string,
): Promise<Record<string, string> | null> {
  const res = (await run([
    "/ip/hotspot/host/print",
    `?mac-address=${mac}`,
  ])) as Array<Record<string, string>>;

  if (res.length) return res[0];

  const all = (await run([
    "/ip/hotspot/host/print",
  ])) as Array<Record<string, string>>;

  const needle = normalizeMacKey(mac);
  return all.find((row) => normalizeMacKey(row["mac-address"] ?? "") === needle) ?? null;
}

/** Find an active Hotspot session by MAC. */
async function findActiveByMac(
  mac: string,
): Promise<Array<Record<string, string>>> {
  const direct = (await run([
    "/ip/hotspot/active/print",
    `?mac-address=${mac}`,
  ])) as Array<Record<string, string>>;

  if (direct.length) return direct;

  const all = (await run([
    "/ip/hotspot/active/print",
  ])) as Array<Record<string, string>>;

  const needle = normalizeMacKey(mac);
  return all.filter((row) => normalizeMacKey(row["mac-address"] ?? "") === needle);
}

async function findIpBindingByMac(
  mac: string,
): Promise<Record<string, string> | null> {
  const res = (await run([
    "/ip/hotspot/ip-binding/print",
    `?mac-address=${mac}`,
  ])) as Array<Record<string, string>>;

  return res.length ? res[0] : null;
}

async function ensureBypassBinding(studentId: string, mac: string): Promise<void> {
  const binding = await findIpBindingByMac(mac);
  if (binding?.[".id"]) {
    await run([
      "/ip/hotspot/ip-binding/set",
      `=.id=${binding[".id"]}`,
      "=type=bypassed",
      "=disabled=no",
      `=comment=fallback:${studentId}`,
    ]);
    return;
  }

  await run([
    "/ip/hotspot/ip-binding/add",
    `=mac-address=${mac}`,
    "=type=bypassed",
    `=comment=fallback:${studentId}`,
  ]);
}

async function removeBypassBinding(mac: string): Promise<void> {
  const binding = await findIpBindingByMac(mac);
  if (!binding?.[".id"]) return;

  await run([
    "/ip/hotspot/ip-binding/remove",
    `=.id=${binding[".id"]}`,
  ]);
}

function normalizeMacKey(value: string): string {
  return value.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
}

function pickAddress(row: Record<string, string>): string | null {
  const raw = row.address ?? row.ip ?? "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function pickServer(row: Record<string, string>): string | null {
  const raw = row.server ?? "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function loginActiveByMac(mac: string, address: string | null): Promise<void> {
  if (!address) {
    throw new Error("missing hotspot client IP for active login");
  }

  const words = [
    "/ip/hotspot/active/login",
    `=user=${mac}`,
    `=password=${mac}`,
    `=mac-address=${mac}`,
  ];

  // RouterOS 7+ requires =ip for this command. We try that first, then fall
  // back to the older =address form if the router rejects it.
  try {
    await run([...words, `=ip=${address}`]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("unknown parameter address") && !msg.includes("missing =ip=")) {
      console.warn("[mikrotik] active/login with =ip failed", msg);
    }
    await run([...words, `=address=${address}`]);
  }
}

async function tryAuthorizeHostById(hostId: string, mac: string, address: string | null): Promise<void> {
  const words = [
    "/ip/hotspot/active/login",
    `=user=${mac}`,
    `=password=${mac}`,
    `=mac-address=${mac}`,
  ];

  try {
    if (address) {
      await run([...words, `=ip=${address}`]);
      return;
    }
    await run(words);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[mikrotik] active login fallback failed for", mac, msg);
  }
}

async function tryLoginCombinations(
  mac: string,
  address: string | null,
  server: string | null,
): Promise<void> {
  const base = [
    "/ip/hotspot/active/login",
    `=user=${mac}`,
    `=password=${mac}`,
    `=mac-address=${mac}`,
  ];

  const attempts: string[][] = [];
  if (address) {
    attempts.push([...base, `=ip=${address}`]);
    attempts.push([...base, `=address=${address}`]);
  }
  if (server) {
    attempts.push([...base, `=server=${server}`]);
    if (address) {
      attempts.push([...base, `=server=${server}`, `=ip=${address}`]);
      attempts.push([...base, `=server=${server}`, `=address=${address}`]);
    }
  }
  attempts.push(base);

  let lastError: unknown = null;
  for (const words of attempts) {
    try {
      await run(words);
      return;
    } catch (err) {
      lastError = err;
    }
  }

  if (lastError) throw lastError;
}

async function waitForActiveSession(mac: string, attempts = 5, delayMs = 800): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    const active = await findActiveByMac(mac);
    if (active.length > 0) return true;
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return false;
}

async function ensureAuthenticatedNow(
  mac: string,
  host: Record<string, string> | null,
): Promise<boolean> {
  if (await waitForActiveSession(mac, 2, 400)) return true;

  if (!host?.[".id"]) return false;

  await tryAuthorizeHostById(host[".id"], mac, pickAddress(host));
  if (await waitForActiveSession(mac, 3, 700)) return true;

  const address = pickAddress(host);
  const server = pickServer(host);
  await tryLoginCombinations(mac, address, server);

  return await waitForActiveSession(mac, 5, 700);
}

function pickHostname(row: Record<string, string>): string | null {
  const raw = row["host-name"] ?? row.hostname ?? row["dhcp-hostname"] ?? "";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Read the client hostname from MikroTik (hotspot host table, then DHCP lease).
 * Call before approveDevice() removes the host entry.
 */
export async function readHostnameByMac(mac: string): Promise<string | null> {
  const hosts = (await run([
    "/ip/hotspot/host/print",
    `?mac-address=${mac}`,
  ])) as Array<Record<string, string>>;

  if (hosts.length > 0) {
    const name = pickHostname(hosts[0]);
    if (name) return name;
  }

  const leases = (await run([
    "/ip/dhcp-server/lease/print",
    `?mac-address=${mac}`,
  ])) as Array<Record<string, string>>;

  if (leases.length > 0) {
    return pickHostname(leases[0]);
  }

  return null;
}

/**
 * Approve a device.
 *
 * Creates or updates a Hotspot user for MAC authentication.
 * Afterward, removes the current Host entry so MikroTik
 * immediately re-evaluates and authenticates the client.
 */
export async function approveDevice(
  studentId: string,
  mac: string,
  clientIp?: string,
): Promise<void> {
  await upsertHotspotUser(studentId, mac);

  // RouterOS 7.x usually requires client IP for active/login. When IP is not
  // available from the request, use current host table data and force a host
  // re-evaluation as a fallback.
  const host = await findHostByMac(mac);
  const ip = clientIp?.trim() || null;
  const hostIp = host ? pickAddress(host) : null;
  const loginIp = ip ?? hostIp;

  let authenticated = false;

  if (host?.[".id"]) {
    try {
      authenticated = await ensureAuthenticatedNow(mac, host);
    } catch (err) {
      console.warn("[mikrotik] host-based auth verification failed for", mac, err);
    }
  }

  if (!authenticated && loginIp) {
    try {
      await loginActiveByMac(mac, loginIp);
      if (host?.[".id"]) {
        authenticated = await ensureAuthenticatedNow(mac, host);
      }
    } catch (err) {
      console.warn("[mikrotik] immediate active login failed for", mac, err);
      if (host?.[".id"]) {
        try {
          await tryAuthorizeHostById(host[".id"], mac, pickAddress(host));
          authenticated = await ensureAuthenticatedNow(mac, host);
        } catch (innerErr) {
          console.warn("[mikrotik] host auth fallback failed for", mac, innerErr);
        }
      }
      if (!authenticated) {
        await ensureBypassBinding(studentId, mac);
      }
    }
  } else if (!authenticated && host?.[".id"]) {
    try {
      await tryAuthorizeHostById(host[".id"], mac, pickAddress(host));
      authenticated = await ensureAuthenticatedNow(mac, host);
    } catch (err) {
      console.warn("[mikrotik] host authorization fallback failed for", mac, err);
      await ensureBypassBinding(studentId, mac);
    }
  } else if (!authenticated) {
    await ensureBypassBinding(studentId, mac);
  }

  if (host?.[".id"]) {
    try {
      await run([
        "/ip/hotspot/host/remove",
        `=.id=${host[".id"]}`,
      ]);
    } catch (err) {
      console.warn("[mikrotik] host remove failed for", mac, err);
    }
  }
}

/**
 * Revoke access.
 *
 * Removes the Hotspot user so the next request
 * is redirected back to the captive portal.
 */
export async function revokeDevice(mac: string): Promise<void> {
  const user = await findHotspotUserByMac(mac);
  if (user?.[".id"]) {
    await run([
      "/ip/hotspot/user/remove",
      `=.id=${user[".id"]}`,
    ]);
  }

  const active = await findActiveByMac(mac);
  for (const row of active) {
    if (row[".id"]) {
      await run([
        "/ip/hotspot/active/remove",
        `=.id=${row[".id"]}`,
      ]);
    }
  }

  const host = await findHostByMac(mac);
  if (host) {
    await run([
      "/ip/hotspot/host/remove",
      `=.id=${host[".id"]}`,
    ]);
  }

  await removeBypassBinding(mac);
}

/** Returns true if this MAC is already approved on the router. */
export async function isDeviceApproved(mac: string): Promise<boolean> {
  const user = await findHotspotUserByMac(mac);
  if (!user) return false;
  return user.disabled !== "true";
}

/** List all hotspot users on the hotspot. */
export async function listApprovedDevices() {
  return (await run([
    "/ip/hotspot/user/print",
  ])) as Array<Record<string, string>>;
}

/**
 * Remove every approved device belonging to a student.
 * Uses the comment field to identify ownership.
 */
export async function revokeAllDevicesForStudent(
  studentId: string,
): Promise<void> {
  const users = (await run([
    "/ip/hotspot/user/print",
    `?comment=${studentId}`,
  ])) as Array<Record<string, string>>;

  for (const user of users) {
    if (user.comment === studentId && user[".id"]) {
      await run([
        "/ip/hotspot/user/remove",
        `=.id=${user[".id"]}`,
      ]);
    }
  }

  const bindings = (await run([
    "/ip/hotspot/ip-binding/print",
    `?comment=fallback:${studentId}`,
  ])) as Array<Record<string, string>>;

  for (const binding of bindings) {
    if (binding[".id"]) {
      await run([
        "/ip/hotspot/ip-binding/remove",
        `=.id=${binding[".id"]}`,
      ]);
    }
  }
}

/** Lightweight connectivity probe for admin diagnostics. */
export async function pingRouter(): Promise<{ ok: true; identity: string }> {
  const rows = (await run(["/system/identity/print"])) as Array<Record<string, string>>;
  return { ok: true, identity: rows[0]?.name ?? "unknown" };
}
