import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Derives the stored session-token hash. Uses HMAC-SHA256 keyed with the
 * server's SESSION_SECRET so a DB-only leak cannot be replayed. The token
 * itself is 256 bits of CSPRNG randomness, never persisted.
 */
@Injectable()
export class SessionTokenHasher {
  private readonly secret: string;

  constructor(configService: ConfigService) {
    const secret = configService.get<string>('SESSION_SECRET');
    if (!secret || secret.length < 32) {
      throw new Error(
        'SESSION_SECRET must be set and at least 32 characters. Copy .env.example to .env.',
      );
    }
    this.secret = secret;
  }

  generate(): { token: string; tokenHash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, tokenHash: this.hash(token) };
  }

  hash(token: string): string {
    return createHmac('sha256', this.secret).update(token).digest('hex');
  }

  /** Constant-time comparison to prevent lookup-oracle timing attacks. */
  equals(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
