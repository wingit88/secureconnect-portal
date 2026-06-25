// Eager patch for node-routeros Channel to ignore the !empty reply.
// This module is intentionally side-effecting and should be imported
// very early in the server runtime (for example from middleware.ts)
// so the Channel.prototype.onUnknown handler is replaced before any
// RouterOS connection is established by other modules.

function applyEmptyPatch(): void {
  try {
    // Try a few ways to locate the Channel class across packaging shapes.
    // @ts-ignore
    let mod: any;
    try {
      mod = require("node-routeros/dist/Channel");
    } catch (_) {
      try {
        const root = require("node-routeros");
        mod = root;
      } catch (e) {
        mod = undefined;
      }
    }

    const Channel =
      (mod && typeof mod === "function" ? mod : undefined) ||
      (mod?.Channel && typeof mod.Channel === "function" ? mod.Channel : undefined) ||
      (mod?.default && typeof mod.default === "function" ? mod.default : undefined) ||
      (mod?.default?.Channel && typeof mod.default.Channel === "function" ? mod.default.Channel : undefined) ||
      (mod?.dist?.Channel && typeof mod.dist.Channel === "function" ? mod.dist.Channel : undefined);
    if (!Channel || !Channel.prototype) return;

    const origOnUnknown = Channel.prototype.onUnknown;
    Channel.prototype.onUnknown = function (reply: string): void {
      try {
        if (reply === "!empty") {
          try { this.emit("done", []); } catch {}
          try { this.close(); } catch {}
          return;
        }
      } catch (_e) {
        // swallow
      }
      if (origOnUnknown) origOnUnknown.call(this, reply);
    };
  } catch (e) {
    // Intentionally silent; we'll log where appropriate elsewhere.
    // Avoid throwing during server startup.
  }
}

applyEmptyPatch();

export {};
