// In-memory token bucket. Single-process Next server is the only writer.
type Bucket = { tokens: number; updatedAt: number };
const buckets = new Map<string, Bucket>();

export function take(key: string, capacity = 10, refillPerSec = 0.5): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: capacity, updatedAt: now };
  const elapsed = (now - b.updatedAt) / 1000;
  b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerSec);
  b.updatedAt = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1;
  buckets.set(key, b);
  return true;
}