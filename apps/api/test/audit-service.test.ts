import { describe, expect, it, vi } from 'vitest';

import { AuditService } from '../src/audit/audit.service';

const input = {
  userId: 'user-1',
  action: 'purchase.create',
  resourceType: 'Purchase',
  resourceId: 'purchase-1',
};

describe('AuditService transaction support', () => {
  it('writes through the supplied transaction client', async () => {
    const prisma = { auditLog: { create: vi.fn() } };
    const tx = { auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) } };
    const service = new AuditService(prisma as never);

    await service.recordInTransaction(tx as never, input);

    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining(input),
    });
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('propagates a transactional audit failure to the caller', async () => {
    const failure = new Error('audit database write failed');
    const tx = { auditLog: { create: vi.fn().mockRejectedValue(failure) } };
    const service = new AuditService({ auditLog: { create: vi.fn() } } as never);

    await expect(service.recordInTransaction(tx as never, input)).rejects.toBe(failure);
  });
});
