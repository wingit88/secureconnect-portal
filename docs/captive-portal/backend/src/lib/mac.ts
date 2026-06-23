// Single chokepoint for MAC formatting. Always normalize before DB or API.
const MAC_RE = /^[0-9A-F]{12}$/;

export function normalize(input: string): string {
  const hex = input.toUpperCase().replace(/[^0-9A-F]/g, "");
  if (!MAC_RE.test(hex)) throw new Error(`Invalid MAC address: ${input}`);
  return hex.match(/.{2}/g)!.join(":");
}

export function isValid(input: string): boolean {
  try { normalize(input); return true; } catch { return false; }
}

export function safeNormalize(input: string | null | undefined): string | null {
  if (!input) return null;
  try { return normalize(input); } catch { return null; }
}