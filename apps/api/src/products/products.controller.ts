import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { Request } from 'express';

import { ProductsService } from './products.service.js';
import { ProductDefinitionDto, UpdateProductDefinitionDto } from './dto/product-definition.dto.js';
import { CurrentUser, AuthContext } from '../common/decorators/current-user.decorator.js';

@Controller('product-definitions')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list() {
    return this.products.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  @Post()
  create(@Body() dto: ProductDefinitionDto, @CurrentUser() user: AuthContext | null) {
    return this.products.create(dto, user?.userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDefinitionDto,
    @CurrentUser() user: AuthContext | null,
    @Req() req: Request,
  ) {
    return this.products.update(id, dto, {
      userId: user?.userId,
      sessionId: user?.sessionId,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
