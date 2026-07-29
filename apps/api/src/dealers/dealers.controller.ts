import { Controller, Get, Query } from '@nestjs/common';

import { DealersService } from './dealers.service.js';

@Controller('dealers')
export class DealersController {
  constructor(private readonly dealers: DealersService) {}

  @Get()
  search(@Query('q') q?: string) {
    return this.dealers.search(q ?? '');
  }
}
