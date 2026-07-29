import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.module.js';

@Injectable()
export class DealersService {
  constructor(private readonly prisma: PrismaService) {}

  async search(q: string) {
    const rows = await this.prisma.purchase.findMany({
      where: {
        dealerName: { not: null },
        ...(q
          ? { dealerName: { contains: q, mode: 'insensitive' as const } }
          : {}),
      },
      select: { dealerName: true, branch: true },
      distinct: ['dealerName', 'branch'],
      orderBy: [{ dealerName: 'asc' }, { branch: 'asc' }],
      take: 50,
    });

    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      const name = r.dealerName!;
      if (!map.has(name)) map.set(name, new Set());
      if (r.branch) map.get(name)!.add(r.branch);
    }

    return [...map.entries()].map(([name, branches]) => ({
      name,
      branches: [...branches].sort(),
    }));
  }
}
