import { Controller, Get } from '@nestjs/common';

import { MetalsService } from './metals.service.js';

@Controller('metals')
export class MetalsController {
  constructor(private readonly metals: MetalsService) {}

  @Get()
  list() {
    return this.metals.list();
  }
}
