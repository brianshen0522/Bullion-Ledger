import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

import { RuntimeConfig } from '../config/runtime.config.js';
import { ConfigService } from '@nestjs/config';
import { loadRuntimeConfig } from '../config/runtime.config.js';

/**
 * Argon2id password hashing (PRD §23). Parameters are configurable but always
 * satisfy the Argon2id memory/time minimums. Never logs inputs.
 */
@Injectable()
export class PasswordService {
  private readonly config: RuntimeConfig['auth'];

  constructor(configService: ConfigService) {
    this.config = loadRuntimeConfig(configService).auth;
  }

  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, {
      type: argon2.argon2id,
      timeCost: this.config.argonTimeCost,
      memoryCost: this.config.argonMemoryCost,
      parallelism: this.config.argonParallelism,
    });
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plaintext);
    } catch {
      // Malformed hash should not leak timing or error detail.
      return false;
    }
  }
}
