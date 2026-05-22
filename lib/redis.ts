// lib/redis.ts — Redis client + atomic rate-limiter for /bruk anti-spam.
//
// Used by app/(site)/bruk/actions.ts to bound per-IP and per-email submit
// rates. kiba-redis is already in compose; this module is the first feature
// to actually wire it.
//
// Env: REDIS_URL (defaults to redis://kiba-redis:6379 inside compose).
// Outside compose (local pnpm dev with no Redis), REDIS_URL is unset and we
// fall back to an in-memory limiter so /bruk still works without infra.

import "server-only";

import IORedis, { type Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL;

let client: Redis | null = null;
let lastConnectError: string | null = null;

// Fixed-window counter implemented as a single Lua script. Atomic: INCR + read
// + conditional EXPIRE in one round trip, so we don't get the read/write race
// that bare INCR + EXPIRE has.
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
  redis.call('EXPIRE', key, window)
end
local ttl = redis.call('TTL', key)
if current > limit then
  return {0, ttl}
end
return {1, ttl}
`.trim();

let scriptSha: string | null = null;

function getClient(): Redis | null {
  if (!REDIS_URL) return null;
  if (client) return client;
  try {
    client = new IORedis(REDIS_URL, {
      // Prevent ioredis from queueing commands forever if Redis is down — fail
      // fast so the in-memory fallback kicks in.
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
      connectTimeout: 1000,
    });
    client.on("error", (err) => {
      lastConnectError = String(err?.message ?? err).slice(0, 200);
    });
    return client;
  } catch (e) {
    lastConnectError = e instanceof Error ? e.message : String(e);
    return null;
  }
}

// In-memory fallback. Stricter than Redis-backed (per-process counters), but
// keeps the form working when Redis is unreachable. Acceptable in local dev
// and during brief Redis outages on Apollo.
const memCounters = new Map<string, { count: number; expiresAt: number }>();

function memCheckRate(
  key: string,
  max: number,
  windowSec: number,
): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const existing = memCounters.get(key);
  if (!existing || existing.expiresAt <= now) {
    memCounters.set(key, { count: 1, expiresAt: now + windowSec * 1000 });
    return { ok: true, retryAfter: 0 };
  }
  existing.count += 1;
  const ttl = Math.ceil((existing.expiresAt - now) / 1000);
  if (existing.count > max) {
    return { ok: false, retryAfter: ttl };
  }
  return { ok: true, retryAfter: ttl };
}

export type RateCheck = { ok: boolean; retryAfter: number; source: "redis" | "memory" };

/**
 * Check + increment a rate-limit counter. Returns ok=false when the count
 * exceeds `max` within the rolling `windowSec` window. Side-effect: increments
 * the counter on every call (limited or not).
 *
 * Falls back to in-memory counters when REDIS_URL is unset or Redis is
 * unreachable. Surface the `source` field to the caller so they can log
 * "redis unavailable, using memory fallback."
 */
export async function checkRate(
  key: string,
  max: number,
  windowSec: number,
): Promise<RateCheck> {
  const c = getClient();
  if (!c) {
    const mem = memCheckRate(key, max, windowSec);
    return { ...mem, source: "memory" };
  }
  try {
    if (!scriptSha) {
      scriptSha = await c.script("LOAD", RATE_LIMIT_LUA) as string;
    }
    const result = (await c.evalsha(
      scriptSha,
      1,
      key,
      String(max),
      String(windowSec),
    )) as [number, number];
    return {
      ok: result[0] === 1,
      retryAfter: result[1] > 0 ? result[1] : windowSec,
      source: "redis",
    };
  } catch (e) {
    // NOSCRIPT (script flushed) → reload and retry once. Any other failure
    // falls through to memory fallback.
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("NOSCRIPT")) {
      scriptSha = null;
      try {
        scriptSha = (await c.script("LOAD", RATE_LIMIT_LUA)) as string;
        const result = (await c.evalsha(
          scriptSha,
          1,
          key,
          String(max),
          String(windowSec),
        )) as [number, number];
        return {
          ok: result[0] === 1,
          retryAfter: result[1] > 0 ? result[1] : windowSec,
          source: "redis",
        };
      } catch {
        // Fall through to memory.
      }
    }
    lastConnectError = msg.slice(0, 200);
    const mem = memCheckRate(key, max, windowSec);
    return { ...mem, source: "memory" };
  }
}

/** Diagnostics for /admin/bruk health card. */
export function redisStatus(): {
  configured: boolean;
  connected: boolean;
  lastError: string | null;
} {
  return {
    configured: Boolean(REDIS_URL),
    connected: Boolean(client) && lastConnectError === null,
    lastError: lastConnectError,
  };
}
