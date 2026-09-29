/**
 * Slows password guessing on POST /api/auth/login.
 *
 * Requests that reach the server from the public internet through a
 * Tailscale Funnel all arrive from the local tailscaled proxy, so their
 * socket address says nothing about the caller. They share one strict
 * "public" bucket; a lockout there never blocks tailnet or LAN logins, which
 * are counted per client address.
 */

export interface LoginThrottlePolicy {
  /** Failures inside `windowMs` that trigger a lockout. */
  maxFailures: number;
  windowMs: number;
  /** First lockout; each further lockout doubles it up to `maxLockMs`. */
  lockMs: number;
  maxLockMs: number;
}

export const PUBLIC_LOGIN_POLICY: LoginThrottlePolicy = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  lockMs: 15 * 60_000,
  maxLockMs: 24 * 60 * 60_000,
};

export const PRIVATE_LOGIN_POLICY: LoginThrottlePolicy = {
  maxFailures: 10,
  windowMs: 15 * 60_000,
  lockMs: 5 * 60_000,
  maxLockMs: 60 * 60_000,
};

interface BucketState {
  failures: number[];
  lockedUntil: number;
  lockouts: number;
}

const MAX_BUCKETS = 10_000;

export class LoginThrottle {
  private readonly buckets = new Map<string, BucketState>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Milliseconds until another attempt is allowed; 0 when allowed now. */
  retryAfterMs(key: string): number {
    const state = this.buckets.get(key);
    if (!state) return 0;
    return Math.max(0, state.lockedUntil - this.now());
  }

  recordFailure(key: string, policy: LoginThrottlePolicy): void {
    const now = this.now();
    let state = this.buckets.get(key);
    if (!state) {
      if (this.buckets.size >= MAX_BUCKETS) {
        const oldest = this.buckets.keys().next().value;
        if (oldest !== undefined) this.buckets.delete(oldest);
      }
      state = { failures: [], lockedUntil: 0, lockouts: 0 };
      this.buckets.set(key, state);
    }
    state.failures = state.failures.filter((at) => now - at < policy.windowMs);
    state.failures.push(now);
    if (state.failures.length >= policy.maxFailures) {
      const lock = Math.min(
        policy.lockMs * 2 ** state.lockouts,
        policy.maxLockMs,
      );
      state.lockedUntil = now + lock;
      state.lockouts += 1;
      state.failures = [];
    }
  }

  recordSuccess(key: string): void {
    this.buckets.delete(key);
  }
}

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().split("%", 1)[0];
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "::ffff:127.0.0.1"
  );
}

/**
 * Which bucket a login attempt counts against. Tailscale marks Funnel
 * traffic with `Tailscale-Funnel-Request`; tailnet traffic through
 * `tailscale serve` carries `Tailscale-User-Login` instead. A proxied
 * request with neither is treated as public, too.
 */
export function loginThrottleKey(
  remoteAddress: string | undefined,
  header: (name: string) => string | undefined,
): { key: string; policy: LoginThrottlePolicy } {
  const funnel = header("tailscale-funnel-request") !== undefined;
  const proxiedWithoutIdentity =
    isLoopback(remoteAddress) && !header("tailscale-user-login");
  if (funnel || proxiedWithoutIdentity || !remoteAddress) {
    return { key: "public", policy: PUBLIC_LOGIN_POLICY };
  }
  return { key: `addr:${remoteAddress}`, policy: PRIVATE_LOGIN_POLICY };
}
