import { Redis } from "@upstash/redis";

// ─── Redis Client ──────────────────────────────────────────────────────────────
// Shared singleton — supports both UPSTASH_REDIS_* and legacy KV_* env vars.

const redisUrl =
  process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "";
const redisToken =
  process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "";

export const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

/** Whether Redis credentials are configured (prevents crashes on missing env). */
export const redisEnabled = Boolean(redisUrl && redisToken);

/**
 * Safe cache GET — returns null on missing credentials or errors.
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!redisEnabled) return null;
  try {
    return await redis.get<T>(key);
  } catch (e) {
    console.warn("[redis] cache get failed:", e);
    return null;
  }
}

/**
 * Safe cache SET — silently skips on missing credentials or errors.
 */
export async function cacheSet(key: string, value: unknown): Promise<void> {
  if (!redisEnabled) return;
  try {
    await redis.set(key, value);
  } catch (e) {
    console.warn("[redis] cache set failed:", e);
  }
}
