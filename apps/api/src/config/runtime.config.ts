import { ConfigService } from '@nestjs/config';

/**
 * Centralized environment-derived runtime configuration. Keeping access in
 * one place makes it trivial to audit every place that reads a secret or a
 * security-sensitive flag.
 */
export interface CookieSettings {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  path: string;
  /** Absolute session lifetime in seconds. */
  absoluteTtlSec: number;
  /** Idle (sliding) session lifetime in seconds. */
  idleTtlSec: number;
}

export interface AuthSettings {
  /** Whether the public first-run initialization endpoint is enabled. */
  allowHttpInit: boolean;
  /** Argon2id time cost. */
  argonTimeCost: number;
  argonMemoryCost: number;
  argonParallelism: number;
  /** Max login attempts before lockout window resets. */
  maxAttempts: number;
  /** Lockout window in seconds. */
  lockoutWindowSec: number;
  /** Iterations of hashing for session token lookups (SHA-256). */
  sessionTokenHashIterations: number;
}

export interface RuntimeConfig {
  nodeEnv: string;
  webOrigin: string;
  /** Number of controlled reverse-proxy hops in front of the API. */
  trustedProxyHops: number;
  cookie: CookieSettings;
  auth: AuthSettings;
}

export function loadRuntimeConfig(config: ConfigService): RuntimeConfig {
  const nodeEnv = config.get<string>('NODE_ENV') ?? 'development';
  const isProd = nodeEnv === 'production';
  const cookieSecure = parseBool(config.get<string>('COOKIE_SECURE'), isProd, 'COOKIE_SECURE');
  const absoluteTtlSec = parseBoundedInteger(
    config.get<string>('SESSION_ABSOLUTE_TTL_SEC'),
    60 * 60 * 24 * 7,
    'SESSION_ABSOLUTE_TTL_SEC',
    60,
    60 * 60 * 24 * 365,
  );
  const idleTtlSec = parseBoundedInteger(
    config.get<string>('SESSION_IDLE_TTL_SEC'),
    60 * 30,
    'SESSION_IDLE_TTL_SEC',
    60,
    absoluteTtlSec,
  );

  if (isProd && !cookieSecure) {
    throw new Error('COOKIE_SECURE cannot be disabled when NODE_ENV=production');
  }

  return {
    nodeEnv,
    // WEB_ORIGIN remains a compatibility fallback for existing standalone
    // deployments; PUBLIC_ORIGIN is the canonical browser-facing setting.
    webOrigin:
      config.get<string>('PUBLIC_ORIGIN') ??
      config.get<string>('WEB_ORIGIN') ??
      'http://localhost:5173',
    trustedProxyHops: parseBoundedInteger(
      config.get<string>('TRUST_PROXY_HOPS'),
      0,
      'TRUST_PROXY_HOPS',
      0,
      5,
    ),
    cookie: {
      name: config.get<string>('SESSION_COOKIE_NAME') ?? 'bl_session',
      httpOnly: true,
      secure: cookieSecure,
      // 'none' requires Secure=true which we enforce for prod. In dev we use
      // 'lax' so the cross-origin Vite -> API cookie still works on same-site
      // navigations while preventing CSRF from foreign origins.
      sameSite: cookieSecure ? 'none' : 'lax',
      path: '/',
      absoluteTtlSec,
      idleTtlSec,
    },
    auth: {
      // Development keeps the first-run flow convenient. Production requires
      // an explicit, temporary opt-in so an exposed fresh deployment cannot
      // be claimed by the first network caller.
      allowHttpInit: parseBool(config.get<string>('ALLOW_HTTP_INIT'), !isProd, 'ALLOW_HTTP_INIT'),
      argonTimeCost: parseBoundedInteger(
        config.get<string>('ARGON_TIME_COST'),
        3,
        'ARGON_TIME_COST',
        2,
        10,
      ),
      argonMemoryCost: parseBoundedInteger(
        config.get<string>('ARGON_MEMORY_COST'),
        19_456,
        'ARGON_MEMORY_COST',
        19_456,
        1_048_576,
      ),
      argonParallelism: parseBoundedInteger(
        config.get<string>('ARGON_PARALLELISM'),
        1,
        'ARGON_PARALLELISM',
        1,
        16,
      ),
      maxAttempts: parseBoundedInteger(
        config.get<string>('LOGIN_MAX_ATTEMPTS'),
        5,
        'LOGIN_MAX_ATTEMPTS',
        1,
        100,
      ),
      lockoutWindowSec: parseBoundedInteger(
        config.get<string>('LOGIN_LOCKOUT_WINDOW_SEC'),
        60 * 15,
        'LOGIN_LOCKOUT_WINDOW_SEC',
        1,
        86_400,
      ),
      sessionTokenHashIterations: 100_000,
    },
  };
}

function parseBool(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true') return true;
  if (normalized === '0' || normalized === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function parseBoundedInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum || n > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return n;
}
