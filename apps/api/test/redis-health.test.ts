import { describe, expect, it } from 'vitest';

import { parseRedisUrl } from '../src/queue/redis-health.service.js';

describe('Redis readiness configuration', () => {
  it('parses credentials, database, and TLS without exposing them', () => {
    expect(parseRedisUrl('rediss://queue-user:p%40ss@example.test:6381/4')).toEqual({
      host: 'example.test',
      port: 6381,
      tls: true,
      username: 'queue-user',
      password: 'p@ss',
      database: 4,
    });
  });

  it('uses conventional ports and rejects unsupported URLs', () => {
    expect(parseRedisUrl('redis://localhost')).toMatchObject({ port: 6379, tls: false });
    expect(parseRedisUrl('rediss://localhost')).toMatchObject({ port: 6380, tls: true });
    expect(() => parseRedisUrl('http://localhost:6379')).toThrow(/redis:\/\/ or rediss:\/\//);
  });
});
