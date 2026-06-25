// Eager patches for node-routeros to handle quirks in RouterOS API responses.
// This module is intentionally side-effecting and MUST be imported very early
// in the server runtime so prototypes are patched before any connection is made.
//
// Patch 1 — Channel.prototype.onUnknown: treats "!empty" as a successful empty
// result instead of an unknown reply, because RouterOS sends "!empty" for print
// commands that match no entries (e.g. /ip/hotspot/user/print ?name=unknown).
//
// Patch 2 — Receiver.prototype.sendTagData: swallows UNREGISTEREDTAG instead of
// throwing. This is the companion to patch 1: when we handle "!empty" in
// onUnknown we emit "done" and close the channel, which deregisters the tag.
// RouterOS then sends its own "!done" for the same command. Receiver.sendTagData
// finds no handler for the (now-gone) tag and throws UNREGISTEREDTAG
// synchronously inside the TCP socket "data" event. Node.js converts that throw
// into a socket "error" event, which tears down the connection and causes the
// *next* RouterOS command in the job (e.g. /ip/hotspot/user/add) to time out.
// Swallowing UNREGISTEREDTAG at the source keeps the connection alive.

import { createRequire } from "module";
const requireModule = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Patch 1: Channel.prototype.onUnknown — handle "!empty"
// ---------------------------------------------------------------------------
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

    if (!Channel || !Channel.prototype) {
      console.warn("node-routeros patch: Channel prototype not found");
      return;
    }

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
    console.info("node-routeros patch active: !empty handler");
  } catch {
    console.warn("node-routeros patch failed to apply");
  }
}

// ---------------------------------------------------------------------------
// Patch 2: Receiver.prototype.sendTagData — swallow UNREGISTEREDTAG
// ---------------------------------------------------------------------------
function applyUnregisteredTagPatch(): void {
  try {
    let Receiver: any = undefined;

    try {
      const mod = requireModule("node-routeros/dist/connector/Receiver");
      Receiver = mod?.default ?? mod;
    } catch {
      // ignore
    }

    if (!Receiver?.prototype?.sendTagData) {
      console.warn("node-routeros patch: Receiver.sendTagData not found — UNREGISTEREDTAG may still throw");
      return;
    }

    const origSendTagData = Receiver.prototype.sendTagData;
    Receiver.prototype.sendTagData = function (...args: unknown[]): unknown {
      try {
        return origSendTagData.apply(this, args);
      } catch (e: unknown) {
        // UNREGISTEREDTAG is thrown when RouterOS sends a trailing !done after
        // we already closed the channel (because we handled !empty). The tag is
        // gone but the data still arrives. Safe to discard.
        if ((e as any)?.errno === "UNREGISTEREDTAG") return;
        throw e;
      }
    };
    console.info("node-routeros patch active: UNREGISTEREDTAG handler");
  } catch {
    console.warn("node-routeros patch: Receiver patch failed to apply");
  }
}

applyEmptyPatch();
applyUnregisteredTagPatch();

export {};
