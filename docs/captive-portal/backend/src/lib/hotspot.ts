/** Base URL of the MikroTik hotspot gateway (VLAN 30, typically 192.168.30.1). */
export function hotspotGatewayBase(): string {
  const configured = process.env.HOTSPOT_GATEWAY_URL ?? "http://192.168.30.1/status";
  try {
    const url = new URL(configured);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "http://192.168.30.1";
  }
}

export function hotspotStatusUrl(): string {
  return `${hotspotGatewayBase()}/status`;
}

function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/** When the client was trying to reach the gateway itself, land on /status. */
export function resolveContinueUrl(target: string): string {
  const statusUrl = hotspotStatusUrl();
  if (!/^https?:\/\//i.test(target)) return statusUrl;

  try {
    const requested = new URL(target);
    if (isLocalHost(requested.hostname)) return statusUrl;

    const gateway = new URL(hotspotGatewayBase());
    if (requested.hostname === gateway.hostname) return statusUrl;
  } catch {
    return statusUrl;
  }

  return target;
}
