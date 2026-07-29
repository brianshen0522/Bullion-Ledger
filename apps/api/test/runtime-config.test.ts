import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { loadRuntimeConfig } from '../src/config/runtime.config';

function config(values: Record<string, string | undefined>): ConfigService {
  return {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
}

describe('runtime security configuration', () => {
  it('defaults production cookies to secure and HTTP init to disabled', () => {
    const runtime = loadRuntimeConfig(config({ NODE_ENV: 'production' }));
    expect(runtime.cookie.secure).toBe(true);
    expect(runtime.auth.allowHttpInit).toBe(false);
  });

  it('rejects explicitly insecure production cookies', () => {
    expect(() =>
      loadRuntimeConfig(config({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })),
    ).toThrow('COOKIE_SECURE cannot be disabled');
  });

  it('allows an explicit production initialization opt-in', () => {
    const runtime = loadRuntimeConfig(config({ NODE_ENV: 'production', ALLOW_HTTP_INIT: 'true' }));
    expect(runtime.auth.allowHttpInit).toBe(true);
  });

  it('rejects ambiguous boolean configuration', () => {
    expect(() => loadRuntimeConfig(config({ COOKIE_SECURE: 'sometimes' }))).toThrow(
      'COOKIE_SECURE must be true or false',
    );
  });

  it('rejects weakened Argon2 and invalid session lifetime settings', () => {
    expect(() => loadRuntimeConfig(config({ ARGON_MEMORY_COST: '4096' }))).toThrow(
      'ARGON_MEMORY_COST must be an integer between 19456 and 1048576',
    );
    expect(() =>
      loadRuntimeConfig(config({ SESSION_ABSOLUTE_TTL_SEC: '3600', SESSION_IDLE_TTL_SEC: '7200' })),
    ).toThrow('SESSION_IDLE_TTL_SEC must be an integer between 60 and 3600');
    expect(() => loadRuntimeConfig(config({ LOGIN_MAX_ATTEMPTS: '2.5' }))).toThrow(
      'LOGIN_MAX_ATTEMPTS must be an integer',
    );
  });

  it('trusts no proxy by default and bounds an explicit gateway hop count', () => {
    expect(loadRuntimeConfig(config({})).trustedProxyHops).toBe(0);
    expect(loadRuntimeConfig(config({ TRUST_PROXY_HOPS: '1' })).trustedProxyHops).toBe(1);
    expect(() => loadRuntimeConfig(config({ TRUST_PROXY_HOPS: '6' }))).toThrow(
      'TRUST_PROXY_HOPS must be an integer between 0 and 5',
    );
  });

  it('uses PUBLIC_ORIGIN as canonical while retaining WEB_ORIGIN compatibility', () => {
    expect(loadRuntimeConfig(config({ PUBLIC_ORIGIN: 'https://ledger.example' })).webOrigin).toBe(
      'https://ledger.example',
    );
    expect(loadRuntimeConfig(config({ WEB_ORIGIN: 'https://legacy.example' })).webOrigin).toBe(
      'https://legacy.example',
    );
    expect(
      loadRuntimeConfig(
        config({
          PUBLIC_ORIGIN: 'https://ledger.example',
          WEB_ORIGIN: 'https://legacy.example',
        }),
      ).webOrigin,
    ).toBe('https://ledger.example');
  });
});
