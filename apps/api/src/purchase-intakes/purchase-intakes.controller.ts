import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { CurrentUser, type AuthContext } from '../common/decorators/current-user.decorator.js';
import { PurchasesService } from '../purchases/purchases.service.js';
import { PurchaseDto } from '../purchases/dto/purchase.dto.js';
import {
  CreatePurchaseIntakeDto,
  ListPurchaseIntakesQueryDto,
  PurchaseIntakeIdParamDto,
  UpdatePurchaseIntakeDto,
} from './dto/purchase-intake.dto.js';
import { PurchaseIntakesService } from './purchase-intakes.service.js';

@Controller('purchase-intakes')
export class PurchaseIntakesController {
  constructor(
    private readonly intakes: PurchaseIntakesService,
    private readonly purchases: PurchasesService,
  ) {}

  @Post()
  create(
    @Body() dto: CreatePurchaseIntakeDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    const auth = requireUser(user);
    return this.intakes.create(auth.userId, dto, auditContext(auth, req));
  }

  @Get()
  list(@Query() query: ListPurchaseIntakesQueryDto, @CurrentUser() user: AuthContext | null) {
    return this.intakes.list(requireUser(user).userId, query.status);
  }

  @Get(':id')
  get(@Param() params: PurchaseIntakeIdParamDto, @CurrentUser() user: AuthContext | null) {
    return this.intakes.get(requireUser(user).userId, params.id);
  }

  @Patch(':id')
  update(
    @Param() params: PurchaseIntakeIdParamDto,
    @Body() dto: UpdatePurchaseIntakeDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    const auth = requireUser(user);
    return this.intakes.update(auth.userId, params.id, dto, auditContext(auth, req));
  }

  @Delete(':id')
  cancel(
    @Param() params: PurchaseIntakeIdParamDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    const auth = requireUser(user);
    return this.intakes.cancel(auth.userId, params.id, auditContext(auth, req));
  }

  @Post(':id/finalize')
  finalize(
    @Param() params: PurchaseIntakeIdParamDto,
    @Body() dto: PurchaseDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    const auth = requireUser(user);
    return this.purchases.createFromIntake(
      params.id,
      auth.userId,
      dto,
      idempotencyKey,
      auditContext(auth, req),
    );
  }
}

function requireUser(user: AuthContext | null): AuthContext {
  if (!user) throw new UnauthorizedException('Session required');
  return user;
}

function auditContext(user: AuthContext, req: Request) {
  return {
    userId: user.userId,
    sessionId: user.sessionId,
    ip: req.ip || undefined,
    userAgent: req.headers['user-agent'],
  };
}
