import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.module.js';
import { PasswordService } from './password.service.js';
import { InitDto } from './dto/init.dto.js';
import { loadRuntimeConfig } from '../config/runtime.config.js';

/** Stable Postgres advisory lock key used to serialize first-run init. */
const INIT_LOCK_KEY = 91027462n;

/**
 * Implements the one-time single-user initialization flow (PRD §4.2).
 *
 * Race safety: every initializer takes a transaction-scoped Postgres advisory
 * lock on a constant key, then re-checks the user count. Two concurrent init
 * requests cannot both create a user.
 */
@Injectable()
export class InitService {
  private readonly logger = new Logger('Init');
  private readonly allowHttpInit: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    configService: ConfigService,
  ) {
    this.allowHttpInit = loadRuntimeConfig(configService).auth.allowHttpInit;
  }

  async isInitialized(): Promise<boolean> {
    const count = await this.prisma.appUser.count();
    return count > 0;
  }

  async initialize(dto: InitDto): Promise<{ userId: string; username: string }> {
    if (!this.allowHttpInit) {
      this.logger.warn('HTTP initialization rejected because ALLOW_HTTP_INIT is disabled');
      throw new ForbiddenException('HTTP initialization is disabled');
    }

    // Avoid an expensive Argon2 operation on every request after first-run.
    // This is only a fast path: the advisory-locked transaction below still
    // re-checks the invariant so concurrent initializers remain race-safe.
    try {
      if (await this.isInitialized()) {
        throw new ConflictException('System is already initialized');
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      this.logger.error(`Initialization status check failed: ${(error as Error).message}`);
      throw new ServiceUnavailableException('Initialization unavailable');
    }

    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const user = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${INIT_LOCK_KEY}::bigint)`;
        const existing = await tx.appUser.count();
        if (existing > 0) {
          throw new ConflictError();
        }
        return tx.appUser.create({
          data: {
            username: dto.username,
            passwordHash,
          },
        });
      });
      this.logger.log(`Initialized user "${dto.username}"`);
      return { userId: user.id, username: user.username };
    } catch (e) {
      if (e instanceof ConflictError) {
        throw new ConflictException('System is already initialized');
      }
      this.logger.error(`Initialization failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Initialization failed');
    }
  }
}

class ConflictError extends Error {}
