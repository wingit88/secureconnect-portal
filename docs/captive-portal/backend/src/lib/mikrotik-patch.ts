// Patches node-routeros before any RouterOS connection is opened.
// Import from middleware.ts (and mikrotik.ts) at server startup.
//
// 1. Channel — treat !empty as an empty result (normal for print/add/remove).
// 2. Receiver — ignore stale replies for closed tags (UNREGISTEREDTAG).
// 3. RouterOSAPI — disable holdConnection() background "#" pings that open
//    extra channels while a command is in flight (root cause of UNREGISTEREDTAG).

let patched = false;

function resolveExport(mod: unknown): { prototype?: Record<string, unknown> } | null {
  if (!mod) return null;
  if (typeof mod === "function" && (mod as { prototype?: unknown }).prototype) {
    return mod as { prototype: Record<string, unknown> };
  }
  const record = mod as Record<string, unknown>;
  for (const key of ["default", "Channel", "Receiver", "RouterOSAPI"]) {
    const candidate = record[key];
    if (typeof candidate === "function" && (candidate as { prototype?: unknown }).prototype) {
      return candidate as { prototype: Record<string, unknown> };
    }
  }
  const nested = record.default as Record<string, unknown> | undefined;
  if (nested) {
    for (const key of ["Channel", "Receiver", "RouterOSAPI"]) {
      const candidate = nested[key];
      if (typeof candidate === "function" && (candidate as { prototype?: unknown }).prototype) {
        return candidate as { prototype: Record<string, unknown> };
      }
    }
  }
  return null;
}

function loadModule(paths: string[]): unknown {
  for (const p of paths) {
    try {
      // @ts-ignore — require at runtime in Next.js server bundle
      return require(p);
    } catch {
      // try next path
    }
  }
  return undefined;
}

function patchChannel(): void {
  const mod = loadModule(["node-routeros/dist/Channel", "node-routeros"]);
  const Channel = resolveExport(mod);
  if (!Channel?.prototype) return;

  const proto = Channel.prototype as { onUnknown?: (reply: string) => void };
  const origOnUnknown = proto.onUnknown;
  proto.onUnknown = function (reply: string): void {
    if (reply === "!empty") {
      try { (this as { emit: (e: string, d: unknown[]) => void }).emit("done", []); } catch { /* ignore */ }
      try { (this as { close: () => void }).close(); } catch { /* ignore */ }
      return;
    }
    if (origOnUnknown) origOnUnknown.call(this, reply);
  };
}

function patchReceiver(): void {
  const mod = loadModule(["node-routeros/dist/connector/Receiver", "node-routeros"]);
  const Receiver = resolveExport(mod);
  if (!Receiver?.prototype) return;

  const proto = Receiver.prototype as {
    sendTagData?: (tag: string) => void;
    cleanUp?: () => void;
    tags?: Map<string, unknown>;
  };
  const origSend = proto.sendTagData;
  if (!origSend) return;

  proto.sendTagData = function (currentTag: string): void {
    const self = this as {
      tags: Map<string, unknown>;
      currentPacket: string[];
      sendTagData: (tag: string) => void;
      cleanUp: () => void;
    };
    if (!self.tags?.has(currentTag)) {
      // Late reply after the channel was closed/timed out — drop silently.
      try { self.cleanUp(); } catch { /* ignore */ }
      return;
    }
    origSend.call(this, currentTag);
  };
}

function patchRouterOSAPI(): void {
  const mod = loadModule(["node-routeros/dist/RouterOSAPI", "node-routeros"]);
  const RouterOSAPI = resolveExport(mod);
  if (!RouterOSAPI?.prototype) return;

  // The library opens extra "#" channels while waiting for a response.
  // That races with our serial queue and produces UNREGISTEREDTAG errors.
  (RouterOSAPI.prototype as { holdConnection?: () => void }).holdConnection = function () {
    // intentionally empty
  };
}

function applyPatches(): void {
  if (patched) return;
  try {
    patchChannel();
    patchReceiver();
    patchRouterOSAPI();
    patched = true;
  } catch {
    // Avoid throwing during server startup.
  }
}

applyPatches();

export {};
