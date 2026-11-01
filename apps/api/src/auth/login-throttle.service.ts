import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { loadRuntimeConfig } from '../config/runtime.config.js';

interface AttemptRecord {
  windowStart: number;
  failures: number;
  lockedUntil: number | null;
  /** Attempts admitted by consume() whose verification has not finished. */
  inFlight: number;
}

const MAX_BUCKETS = 10_000;

/**
 * Bounded in-memory login throttling (PRD §5.4). Both normalized account and
 * source-IP buckets are charged, preventing username variation from bypassing
 * the limiter. Expired records are pruned and the map has a hard size cap.
 * Multi-instance deployments should swap this for a shared Redis-backed
 * implementation.
 */
@Injectable()
export class LoginThrottleService {
  private readonly logger = new Logger('LoginThrottle');
  private readonly store = new Map<string, AttemptRecord>();
  private readonly maxAttempts: number;
  private readonly windowSec: number;
  private nextPruneAt = 0;

  constructor(configService: ConfigService) {
    const cfg = loadRuntimeConfig(configService).auth;
    this.maxAttempts = cfg.maxAttempts;
    this.windowSec = cfg.lockoutWindowSec;
    if (!Number.isSafeInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new Error('LOGIN_MAX_ATTEMPTS must be a positive integer');
    }
    if (!Number.isSafeInteger(this.windowSec) || this.windowSec < 1) {
      throw new Error('LOGIN_LOCKOUT_WINDOW_SEC must be a positive integer');
    }
  }

  /**
   * Admits one attempt, or throws LockedError if a bucket is locked or already
   * has its remaining attempts in flight. Argon2 takes long enough that failures
   * alone would let a parallel burst through before the first one is counted,
   * so the attempt is reserved here, synchronously. Every admitted attempt must
   * end in recordFailure, recordSuccess, or release.
   */
  consume(username: string, ip?: string): void {
    const now = Date.now();
    this.maybePruneExpired(now);

    const keys = this.bucketKeys(username, ip);
    let retryAfterSeconds = 0;
    for (const key of keys) {
      const rec = this.refreshExisting(key, now);
      if (rec?.lockedUntil && rec.lockedUntil > now) {
        retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((rec.lockedUntil - now) / 1000));
      } else if (rec && rec.failures + rec.inFlight >= this.maxAttempts) {
        retryAfterSeconds = Math.max(retryAfterSeconds, 1);
      }
    }

    if (retryAfterSeconds > 0) {
      throw new LockedError(retryAfterSeconds);
    }

    for (const key of keys) {
      this.getOrCreate(key, now).inFlight += 1;
    }
  }

  /** Ends an admitted attempt that never reached a verdict on the credential. */
  release(username: string, ip?: string): void {
    for (const key of this.bucketKeys(username, ip)) {
      const rec = this.store.get(key);
      if (!rec) continue;
      rec.inFlight = Math.max(0, rec.inFlight - 1);
      if (rec.inFlight === 0 && rec.failures === 0 && !rec.lockedUntil) this.store.delete(key);
    }
  }

  recordFailure(username: string, ip?: string): void {
    const now = Date.now();
    this.maybePruneExpired(now);

    for (const key of this.bucketKeys(username, ip)) {
      const rec = this.getOrCreate(key, now);
      rec.inFlight = Math.max(0, rec.inFlight - 1);
      rec.failures += 1;
      if (rec.failures >= this.maxAttempts) {
        rec.lockedUntil = now + this.windowSec * 1000;
        // Reset the window so the lockout serves its full duration.
        rec.windowStart = now;
        rec.failures = 0;
        this.logger.warn('Login lockout engaged');
      }
    }
  }

  recordSuccess(username: string, ip?: string): void {
    for (const key of this.bucketKeys(username, ip)) {
      this.store.delete(key);
    }
  }

  private refreshExisting(key: string, now: number): AttemptRecord | undefined {
    const existing = this.store.get(key);
    if (!existing) return undefined;

    if (existing.lockedUntil && existing.lockedUntil <= now) {
      this.store.delete(key);
      return undefined;
    }
    if (!existing.lockedUntil && now - existing.windowStart >= this.windowSec * 1000) {
      existing.windowStart = now;
      existing.failures = 0;
    }
    return existing;
  }

  private getOrCreate(key: string, now: number): AttemptRecord {
    const existing = this.refreshExisting(key, now);
    if (existing) return existing;

    this.makeRoom();
    const fresh: AttemptRecord = {
      windowStart: now,
      failures: 0,
      lockedUntil: null,
      inFlight: 0,
    };
    this.store.set(key, fresh);
    return fresh;
  }

  private maybePruneExpired(now: number): void {
    if (now < this.nextPruneAt) return;

    const ttlMs = this.windowSec * 1000;
    for (const [key, rec] of this.store) {
      const expiresAt = rec.lockedUntil ?? rec.windowStart + ttlMs;
      if (expiresAt <= now) this.store.delete(key);
    }
    // Amortize cleanup work under attack; accessed records are still expired
    // synchronously by refreshExisting, and MAX_BUCKETS caps memory meanwhile.
    this.nextPruneAt = now + Math.max(1_000, Math.min(ttlMs, 60_000));
  }

  private makeRoom(): void {
    if (this.store.size < MAX_BUCKETS) return;
    // Evicting a live lockout would let a flood of new keys lift it early.
    for (const [key, rec] of this.store) {
      if (!rec.lockedUntil) {
        this.store.delete(key);
        return;
      }
    }
    const oldestKey = this.store.keys().next().value as string | undefined;
    if (oldestKey !== undefined) this.store.delete(oldestKey);
  }

  private bucketKeys(username: string, ip?: string): string[] {
    const account = username.trim().normalize('NFKC').toLocaleLowerCase('en-US');
    const keys = [`account:${account}`];
    const normalizedIp = ip?.trim().toLocaleLowerCase('en-US').slice(0, 128);
    if (normalizedIp) keys.push(`ip:${normalizedIp}`);
    return keys;
  }
}

export class LockedError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Too many login attempts; retry in ${retryAfterSeconds}s`);
    this.name = 'LockedError';
  }
}
