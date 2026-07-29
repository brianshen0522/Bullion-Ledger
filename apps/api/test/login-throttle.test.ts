import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LockedError, LoginThrottleService } from '../src/auth/login-throttle.service';

function makeService(maxAttempts = 3, windowSec = 60): LoginThrottleService {
  const get = (key: string): string | undefined => {
    const map: Record<string, string> = {
      NODE_ENV: 'test',
      LOGIN_MAX_ATTEMPTS: String(maxAttempts),
      LOGIN_LOCKOUT_WINDOW_SEC: String(windowSec),
    };
    return map[key];
  };
  return new LoginThrottleService({ get } as unknown as ConfigService);
}

describe('LoginThrottleService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows attempts below threshold', () => {
    const s = makeService(3, 60);
    s.consume('alice');
    s.recordFailure('alice');
    s.recordFailure('alice');
    expect(() => s.consume('alice')).not.toThrow();
  });

  it('locks after max failures', () => {
    const s = makeService(3, 60);
    for (let i = 0; i < 3; i++) {
      s.consume('alice');
      s.recordFailure('alice');
    }
    expect(() => s.consume('alice')).toThrow(LockedError);
  });

  it('resets on success', () => {
    const s = makeService(3, 60);
    s.consume('alice');
    s.recordFailure('alice');
    s.recordSuccess('alice');
    // Counter reset; should not lock after 2 fresh failures
    s.consume('alice');
    s.recordFailure('alice');
    s.recordFailure('alice');
    expect(() => s.consume('alice')).not.toThrow();
  });

  it('isolates usernames', () => {
    const s = makeService(2, 60);
    s.consume('alice');
    s.recordFailure('alice');
    s.recordFailure('alice');
    expect(() => s.consume('alice')).toThrow(LockedError);
    expect(() => s.consume('bob')).not.toThrow();
  });

  it('normalizes account buckets', () => {
    const s = makeService(2, 60);
    s.recordFailure('Alice');
    s.recordFailure(' alice ');
    expect(() => s.consume('ALICE')).toThrow(LockedError);
  });

  it('limits username spraying from one source IP', () => {
    const s = makeService(3, 60);
    s.recordFailure('alice', '192.0.2.5');
    s.recordFailure('bob', '192.0.2.5');
    s.recordFailure('charlie', '192.0.2.5');
    expect(() => s.consume('different-name', '192.0.2.5')).toThrow(LockedError);
    expect(() => s.consume('different-name', '192.0.2.6')).not.toThrow();
  });

  it('reports retry-after and expires locked buckets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-28T00:00:00.000Z'));
    const s = makeService(1, 60);
    s.recordFailure('alice', '192.0.2.5');

    let locked: LockedError | undefined;
    try {
      s.consume('alice', '192.0.2.5');
    } catch (error) {
      if (error instanceof LockedError) locked = error;
    }
    expect(locked?.retryAfterSeconds).toBe(60);

    vi.advanceTimersByTime(60_000);
    expect(() => s.consume('alice', '192.0.2.5')).not.toThrow();
  });

  it('keeps attacker-controlled bucket storage bounded', () => {
    const s = makeService(3, 60);
    for (let i = 0; i < 5_100; i += 1) {
      s.recordFailure(`user-${i}`, `192.0.2.${i}`);
    }

    const internals = s as unknown as { store: Map<string, unknown> };
    expect(internals.store.size).toBeLessThanOrEqual(10_000);
  });
});
