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
        mod = root?.Channel || root?.default?.Channel || root?.dist?.Channel || root?.default;
      } catch (e) {
        mod = undefined;
      }
    }
    const Channel = mod?.default ?? mod;
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
