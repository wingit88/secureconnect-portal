// Eager patch for node-routeros Channel to treat !empty as a normal empty result.
// Import this very early (middleware.ts) so the handler is in place before any
// RouterOS connection is opened.

let patched = false;

function applyEmptyPatch(): void {
  if (patched) return;
  try {
    // @ts-ignore — require is available at runtime in Next.js server bundles
    let mod: unknown;
    try {
      mod = require("node-routeros/dist/Channel");
    } catch {
      try {
        mod = require("node-routeros");
      } catch {
        mod = undefined;
      }
    }

    const record = mod as Record<string, unknown> | undefined;
    const Channel =
      (typeof mod === "function" ? mod : undefined)
      ?? (typeof record?.Channel === "function" ? record.Channel : undefined)
      ?? (typeof record?.default === "function" ? record.default : undefined)
      ?? (typeof (record?.default as Record<string, unknown> | undefined)?.Channel === "function"
        ? (record!.default as { Channel: new (...args: unknown[]) => unknown }).Channel
        : undefined);

    if (!Channel || !(Channel as { prototype?: unknown }).prototype) return;

    const proto = (Channel as { prototype: { onUnknown?: (reply: string) => void } }).prototype;
    const origOnUnknown = proto.onUnknown;
    proto.onUnknown = function (reply: string): void {
      if (reply === "!empty") {
        try { (this as { emit: (e: string, d: unknown[]) => void }).emit("done", []); } catch { /* ignore */ }
        try { (this as { close: () => void }).close(); } catch { /* ignore */ }
        return;
      }
      if (origOnUnknown) origOnUnknown.call(this, reply);
    };
    patched = true;
  } catch {
    // Avoid throwing during server startup; mikrotik.ts logs if commands fail.
  }
}

applyEmptyPatch();

export {};
