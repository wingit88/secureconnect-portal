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

const COMMAND_TIMEOUT_MS = envInt("MIKROTIK_COMMAND_TIMEOUT_MS", 12_000);
const CONNECT_TIMEOUT_MS = envInt("MIKROTIK_CONNECT_TIMEOUT_MS", 8_000);
const MAX_RETRIES = envInt("MIKROTIK_MAX_RETRIES", 2);
const SOCKET_TIMEOUT_SEC = envInt("MIKROTIK_SOCKET_TIMEOUT_SEC", 10);
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

async function resetConnection(waitMs = 0): Promise<void> {
  if (conn) {
    try { await conn.close(); } catch { /* ignore */ }
  }
  conn = null;
  connectPromise = null;
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

function setupClientHandlers(c: RouterOSAPI): void {
  c.removeAllListeners("close");
  c.removeAllListeners("error");

  c.on("close", () => {
    if (conn === c) conn = null;
  });

  c.on("error", (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    const benign =
      msg.includes("!empty") ||
      msg.includes("UNREGISTEREDTAG") ||
      msg.includes("unregistered tag");
    if (!benign) {
      console.error("[mikrotik] connection error:", err);
    }
    try { c.close(); } catch { /* ignore */ }
    if (conn === c) conn = null;
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
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
  void resetConnection(500);
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
  if (conn?.connected) return conn;

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
  if (message.includes("UNREGISTEREDTAG") || message.includes("unregistered tag")) {
    return true;
  }
  // remove/set on a missing .id is not fatal for our idempotent flows
  if (cmd.endsWith("/remove") && message.includes("no such item")) return true;
  if (cmd.endsWith("/remove") && message.includes("invalid value")) return true;
  return false;
}

function isTimeoutError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes("timed out");
}

function formatCommand(words: string[]): string {
  return words[0] ?? "unknown";
}

async function runOnce(words: string[]): Promise<unknown[]> {
  const c = await getConn();
  return withTimeout(
    c.write(words) as Promise<unknown[]>,
    COMMAND_TIMEOUT_MS,
    formatCommand(words),
    () => { void resetConnection(400); },
  );
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

      console.warn(
        `[mikrotik] ${formatCommand(words)} failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`,
        err instanceof Error ? err.message : err,
      );

      await resetConnection(isTimeoutError(err) ? 600 : 300);

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
    }
  }

  recordFailure();
  throw lastError;
}

async function run(words: string[]): Promise<unknown[]> {
  return enqueue(() => runInternal(words));
}

/** Run multiple RouterOS commands atomically (one queue slot, no interleaving). */
async function runBatch(fn: () => Promise<void>): Promise<void> {
  return enqueue(fn);
}

// ---------------------------------------------------------------------------
// Hotspot helpers (use runBatch for multi-step ops)
// ---------------------------------------------------------------------------

/** Find an IP Binding by MAC. */
async function findIpBindingByMac(
  mac: string,
): Promise<{ ".id": string } | null> {
  const res = (await runInternal([
    "/ip/hotspot/ip-binding/print",
    `?mac-address=${mac}`,
  ])) as Array<Record<string, string>>;

  return res.length ? { ".id": res[0][".id"] } : null;
}

/** Find a Hotspot Host by MAC. */
async function findHostByMac(
  mac: string,
): Promise<{ ".id": string } | null> {
  const res = (await runInternal([
    "/ip/hotspot/host/print",
    `?mac-address=${mac}`,
  ])) as Array<Record<string, string>>;

  return res.length ? { ".id": res[0][".id"] } : null;
}

async function removeHostByMac(mac: string): Promise<void> {
  const host = await findHostByMac(mac);
  if (host) {
    await runInternal([
      "/ip/hotspot/host/remove",
      `=.id=${host[".id"]}`,
    ]);
  }
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
  return enqueue(async () => {
    const hosts = (await runInternal([
      "/ip/hotspot/host/print",
      `?mac-address=${mac}`,
    ])) as Array<Record<string, string>>;

    if (hosts.length > 0) {
      const name = pickHostname(hosts[0]);
      if (name) return name;
    }

    const leases = (await runInternal([
      "/ip/dhcp-server/lease/print",
      `?mac-address=${mac}`,
    ])) as Array<Record<string, string>>;

    if (leases.length > 0) {
      return pickHostname(leases[0]);
    }

    return null;
  });
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
  mac: string,
): Promise<void> {
  return runBatch(async () => {
    const existing = await findIpBindingByMac(mac);

    if (existing) {
      await runInternal([
        "/ip/hotspot/ip-binding/set",
        `=.id=${existing[".id"]}`,
        "=type=bypassed",
        "=disabled=no",
        `=comment=${studentId}`,
      ]);
    } else {
      await runInternal([
        "/ip/hotspot/ip-binding/add",
        `=mac-address=${mac}`,
        "=type=bypassed",
        `=comment=${studentId}`,
      ]);
    }

    await removeHostByMac(mac);
  });
}

/**
 * Revoke access.
 *
 * Removes the IP Binding so the next request
 * is redirected back to the captive portal.
 */
export async function revokeDevice(mac: string): Promise<void> {
  return runBatch(async () => {
    const binding = await findIpBindingByMac(mac);
    if (binding) {
      await runInternal([
        "/ip/hotspot/ip-binding/remove",
        `=.id=${binding[".id"]}`,
      ]);
    }
    await removeHostByMac(mac);
  });
}

/** Returns true if this MAC is already approved on the router. */
export async function isDeviceApproved(mac: string): Promise<boolean> {
  return enqueue(async () => (await findIpBindingByMac(mac)) !== null);
}

/** Remove hotspot host entries for a list of MACs (bindings untouched). */
export async function clearHotspotHosts(macAddresses: string[]): Promise<void> {
  return runBatch(async () => {
    for (const mac of macAddresses) {
      await removeHostByMac(mac);
    }
  });
}

/** List all IP bindings on the hotspot. */
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
  studentId: string,
): Promise<void> {
  return runBatch(async () => {
    const bindings = (await runInternal([
      "/ip/hotspot/ip-binding/print",
      `?comment=${studentId}`,
    ])) as Array<Record<string, string>>;

    for (const binding of bindings) {
      if (binding.comment === studentId && binding[".id"]) {
        await runInternal([
          "/ip/hotspot/ip-binding/remove",
          `=.id=${binding[".id"]}`,
        ]);
      }
    }
  });
}

/** Lightweight connectivity probe for admin diagnostics. */
export async function pingRouter(): Promise<{ ok: true; identity: string }> {
  const rows = (await run(["/system/identity/print"])) as Array<Record<string, string>>;
  return { ok: true, identity: rows[0]?.name ?? "unknown" };
}
