import { Body, Controller, Get, Param, Patch, Req } from '@nestjs/common';
import { Request } from 'express';

import { AssetsService } from './assets.service.js';
import { UpdateAssetDto } from './dto/update-asset.dto.js';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator.js';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get()
  list() {
    return this.assets.list();
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAssetDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    return this.assets.update(id, dto, {
      userId: user?.userId,
      sessionId: user?.sessionId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
