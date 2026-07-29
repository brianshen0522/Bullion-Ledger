import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { PasswordService } from '../src/auth/password.service';

function makeService(): PasswordService {
  const get = (key: string): string | undefined => {
    const map: Record<string, string> = {
      NODE_ENV: 'test',
      ARGON_TIME_COST: '2',
      ARGON_MEMORY_COST: '19456',
      ARGON_PARALLELISM: '1',
    };
    return map[key];
  };
  return new PasswordService({ get } as unknown as ConfigService);
}

describe('PasswordService (argon2id)', () => {
  it('hashes and verifies a password', async () => {
    const s = makeService();
    const hash = await s.hash('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(await s.verify(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects wrong password', async () => {
    const s = makeService();
    const hash = await s.hash('correct horse battery staple');
    expect(await s.verify(hash, 'WRONG')).toBe(false);
  });

  it('returns false for malformed hash (no throw)', async () => {
    const s = makeService();
    expect(await s.verify('not-a-hash', 'x')).toBe(false);
  });
});
