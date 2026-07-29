import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';

import { PrismaService } from '../prisma/prisma.module.js';
import { Public } from '../common/decorators/public.decorator.js';
import { StorageService } from '../storage/storage.service.js';
import { RedisHealthService } from '../queue/redis-health.service.js';

/**
 * Liveness/readiness checks. Never leaks version, secrets, or internal
 * topology beyond a boolean dependency status (PRD §23).
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly redis: RedisHealthService,
  ) {}

  @Public()
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<{
    status: 'ok' | 'degraded';
    deps: { database: boolean; redis: boolean; objectStorage: boolean };
  }> {
    const deps = {
      database: false,
      redis: false,
      objectStorage: false,
    };
    const [database, redis, objectStorage] = await Promise.all([
      this.checkDatabase(),
      this.redis.checkReady(),
      this.storage.checkReady(),
    ]);
    deps.database = database;
    deps.redis = redis;
    deps.objectStorage = objectStorage;
    const ok = Object.values(deps).every(Boolean);
    response.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ok ? 'ok' : 'degraded', deps };
  }

  private async checkDatabase(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
