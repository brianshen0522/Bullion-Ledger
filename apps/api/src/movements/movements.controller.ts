import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import type { WeightUnit } from '@bullion-ledger/shared';

import { MovementsService } from './movements.service.js';
import {
  GiftInDto,
  GiftOutAssetDto,
  LoseAssetDto,
  SellAssetDto,
  TransferStorageDto,
} from './dto/movement.dto.js';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator.js';
import type { AuditContext } from '../audit/audit.service.js';

function auditContext(user: AuthContext | null, req: Request): AuditContext {
  return {
    userId: user?.userId ?? null,
    sessionId: user?.sessionId ?? null,
    ip: req.ip || null,
    userAgent: req.headers['user-agent'] ?? null,
  };
}

/** Asset lifecycle endpoints (PRD §6.4, §15.3, §22.3). */
@Controller()
export class MovementsController {
  constructor(private readonly movements: MovementsService) {}

  @Get('movements')
  list(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.movements.list(Number.isSafeInteger(parsed) ? parsed : 200);
  }

  @Post('assets/:id/sell')
  @HttpCode(201)
  sell(
    @Param('id') id: string,
    @Body() dto: SellAssetDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    return this.movements.sell({ assetId: id, ...dto }, auditContext(user, req));
  }

  @Post('assets/:id/gift-out')
  @HttpCode(201)
  giftOut(
    @Param('id') id: string,
    @Body() dto: GiftOutAssetDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    return this.movements.giftOut({ assetId: id, ...dto }, auditContext(user, req));
  }

  @Post('assets/:id/lost')
  @HttpCode(201)
  lost(
    @Param('id') id: string,
    @Body() dto: LoseAssetDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    return this.movements.markLost({ assetId: id, ...dto }, auditContext(user, req));
  }

  @Post('assets/:id/damaged')
  @HttpCode(201)
  damaged(
    @Param('id') id: string,
    @Body() dto: LoseAssetDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    return this.movements.markDamaged({ assetId: id, ...dto }, auditContext(user, req));
  }

  @Post('assets/:id/transfer-storage')
  @HttpCode(201)
  transfer(
    @Param('id') id: string,
    @Body() dto: TransferStorageDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    return this.movements.transferStorage({ assetId: id, ...dto }, auditContext(user, req));
  }

  /** Metal received as a gift creates a new holding (PRD §6.4 收到贈與). */
  @Post('assets/gift-in')
  @HttpCode(201)
  giftIn(@Body() dto: GiftInDto, @CurrentUser() user: AuthContext | null, @Req() req: Request) {
    return this.movements.giftIn(
      { ...dto, weightUnit: dto.weightUnit as WeightUnit },
      auditContext(user, req),
    );
  }
}
