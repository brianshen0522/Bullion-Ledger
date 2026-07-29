import { Body, Controller, Get, Headers, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { PurchasesService } from './purchases.service.js';
import { PurchaseDto } from './dto/purchase.dto.js';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator.js';

@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

  @Get()
  list() {
    return this.purchases.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.purchases.get(id);
  }

  @Post()
  create(
    @Body() dto: PurchaseDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    return this.purchases.create(dto, idempotencyKey, {
      userId: user?.userId,
      sessionId: user?.sessionId,
      ip: req.ip || undefined,
      userAgent: req.headers['user-agent'],
    });
  }
}
