import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.module.js';

@Injectable()
export class MetalsService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.metal.findMany({ where: { active: true }, orderBy: { code: 'asc' } });
  }

  /** Looks up by code (XAU / XAG). Throws if missing. */
  async requireByCode(code: string) {
    const metal = await this.prisma.metal.findUnique({ where: { code } });
    if (!metal) throw new NotFoundException(`Metal ${code} not found`);
    return metal;
  }
}
