// Eager patches for node-routeros to handle quirks in RouterOS API responses.
// This module MUST be imported very early so prototypes are patched before
// any connection is established.
//
// WHY THESE PATCHES ARE NEEDED
// ─────────────────────────────────────────────────────────────────────────────
// RouterOS sends "!empty" for /print commands that match nothing (e.g.
// /ip/hotspot/user/print ?name=unknown-user). node-routeros does not handle
// "!empty" and routes it through Channel.onUnknown → throws "UNKNOWNREPLY".
//
// Our Patch 1 (Channel.onUnknown) resolves the pending promise with [] and
// closes the channel, which *deregisters* its tag from Receiver.tags.
//
// RouterOS then sends a trailing "!done" for the same command. Receiver
// receives it, looks up the tag → not found → throws RosException('UNREGISTEREDTAG').
// That throw happens synchronously inside the Socket "data" event handler
// (Connector.onData → Receiver.processRawData → sendTagData → throw).
// Node.js converts the uncaught throw in an EventEmitter listener to a socket
// "error" event, which destroys the connection. The *next* command in the job
// (e.g. /ip/hotspot/user/add) then hits a dead socket and times out after 15s.
//
// Patch 2 (Receiver.prototype.sendTagData) stops the throw at its origin.
// Patch 3 (Connector.prototype.onData)  is belt-and-suspenders: wraps the
// entire data handler in try/catch so any future UNREGISTEREDTAG that escapes
// Patch 2 is absorbed before it can destroy the connection.

import { createRequire } from "module";
const requireModule = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// Patch 1 — Channel.prototype.onUnknown: treat "!empty" as an empty result
// ─────────────────────────────────────────────────────────────────────────────
function applyEmptyPatch(): void {
  try {
    const channelCandidates: Array<unknown> = [];
    try { channelCandidates.push(requireModule("node-routeros/dist/Channel")); } catch { /* ignore */ }
    try {
      const root = requireModule("node-routeros");
      channelCandidates.push(root);
      channelCandidates.push((root as any)?.Channel);
      channelCandidates.push((root as any)?.default);
      channelCandidates.push((root as any)?.default?.Channel);
      channelCandidates.push((root as any)?.dist?.Channel);
    } catch { /* ignore */ }

    let Channel: any = undefined;
    for (const candidate of channelCandidates) {
      if (typeof candidate === "function") { Channel = candidate; break; }
      if (candidate && typeof candidate === "object") {
        if (typeof (candidate as any).Channel === "function") { Channel = (candidate as any).Channel; break; }
        if (typeof (candidate as any).default === "function") { Channel = (candidate as any).default; break; }
      }
    }

    if (!Channel?.prototype) {
      console.warn("node-routeros patch: Channel prototype not found");
      return;
    }

    const origOnUnknown = Channel.prototype.onUnknown;
    Channel.prototype.onUnknown = function (reply: string): void {
      try {
        if (reply === "!empty") {
          try { this.emit("done", []); } catch { /* ignore */ }
          try { this.close(); } catch { /* ignore */ }
          return;
        }
      } catch { /* ignore */ }
      if (origOnUnknown) origOnUnknown.call(this, reply);
    };
    console.info("node-routeros patch active: !empty handler");
  } catch {
    console.warn("node-routeros patch: Channel patch failed");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch 2 — Receiver.prototype.sendTagData: swallow UNREGISTEREDTAG
//
// node-routeros exports as CJS named export:  exports.Receiver = class Receiver
// So require() returns { Receiver: [class], __esModule: true } — we must use
// mod.Receiver, NOT mod.default or mod itself.
// ─────────────────────────────────────────────────────────────────────────────
function applyReceiverPatch(): void {
  try {
    let Receiver: any = undefined;
    try {
      const mod = requireModule("node-routeros/dist/connector/Receiver");
      // CJS named export: mod.Receiver is the class
      Receiver = mod?.Receiver ?? mod?.default ?? mod;
    } catch { /* ignore */ }

    if (typeof Receiver !== "function" || !Receiver.prototype?.sendTagData) {
      console.warn("node-routeros patch: Receiver.sendTagData not found — Connector patch will cover this");
      return;
    }

    const origSendTagData = Receiver.prototype.sendTagData;
    Receiver.prototype.sendTagData = function (...args: unknown[]): unknown {
      try {
        return origSendTagData.apply(this, args);
      } catch (e: unknown) {
        // Trailing !done arrives after we already closed the channel on !empty.
        // The tag is deregistered — safe to discard this packet.
        if ((e as any)?.errno === "UNREGISTEREDTAG") return;
        throw e;
      }
    };
    console.info("node-routeros patch active: Receiver UNREGISTEREDTAG guard");
  } catch {
    console.warn("node-routeros patch: Receiver patch failed");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Patch 3 — Connector.prototype.onData: belt-and-suspenders catch-all
//
// Connector.onData is the socket "data" event handler. Any uncaught throw from
// Receiver.processRawData propagates here and then into the socket event loop,
// destroying the connection. Wrapping it in try/catch is the definitive guard.
//
// CJS named export: exports.Connector = class Connector
// ─────────────────────────────────────────────────────────────────────────────
function applyConnectorPatch(): void {
  try {
    let Connector: any = undefined;
    try {
      const mod = requireModule("node-routeros/dist/connector/Connector");
      Connector = mod?.Connector ?? mod?.default ?? mod;
    } catch { /* ignore */ }

    if (typeof Connector !== "function" || !Connector.prototype?.onData) {
      console.warn("node-routeros patch: Connector.onData not found");
      return;
    }

    const origOnData = Connector.prototype.onData;
    Connector.prototype.onData = function (data: unknown): unknown {
      try {
        return origOnData.call(this, data);
      } catch (e: unknown) {
        if ((e as any)?.errno === "UNREGISTEREDTAG") {
          // Absorbed — trailing RouterOS packet on a closed channel. Connection stays alive.
          return;
        }
        throw e;
      }
    };
    console.info("node-routeros patch active: Connector UNREGISTEREDTAG guard");
  } catch {
    console.warn("node-routeros patch: Connector patch failed");
  }
}

applyEmptyPatch();
applyReceiverPatch();
applyConnectorPatch();

export {};
