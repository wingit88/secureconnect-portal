// Eager patch for node-routeros Channel to ignore the !empty reply.
// This module is intentionally side-effecting and should be imported
// very early in the server runtime (for example from middleware.ts)
// so the Channel.prototype.onUnknown handler is replaced before any
// RouterOS connection is established by other modules.

import { createRequire } from "module";
const requireModule = createRequire(import.meta.url);

function applyEmptyPatch(): void {
  try {
    const channelCandidates: Array<unknown> = [];

    try {
      channelCandidates.push(requireModule("node-routeros/dist/Channel"));
    } catch {
      // ignore
    }

    try {
      const root = requireModule("node-routeros");
      channelCandidates.push(root);
      channelCandidates.push((root as any)?.Channel);
      channelCandidates.push((root as any)?.default);
      channelCandidates.push((root as any)?.default?.Channel);
      channelCandidates.push((root as any)?.dist?.Channel);
    } catch {
      // ignore
    }

    let Channel: any = undefined;
    for (const candidate of channelCandidates) {
      if (typeof candidate === "function") {
        Channel = candidate;
        break;
      }
      if (candidate && typeof candidate === "object") {
        if (typeof (candidate as any).Channel === "function") {
          Channel = (candidate as any).Channel;
          break;
        }
        if (typeof (candidate as any).default === "function") {
          Channel = (candidate as any).default;
          break;
        }
      }
    }

    if (!Channel || !Channel.prototype) return;

    const origOnUnknown = Channel.prototype.onUnknown;
    Channel.prototype.onUnknown = function (reply: string): void {
      try {
        if (reply === "!empty") {
          try { this.emit("done", []); } catch {}
          try { this.close(); } catch {}
          return;
        }
      } catch {
        // swallow
      }
      if (origOnUnknown) origOnUnknown.call(this, reply);
    };
  } catch {
    // Intentionally silent; avoid throwing during server startup.
  }
}

applyEmptyPatch();

export {};
