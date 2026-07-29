import { describe, expect, it, vi } from 'vitest';

import { PriceQueueService, jobKey } from '../src/jobs/price-queue.service';
import { PriceJob } from '../src/jobs/price-jobs';

/**
 * BullMQ throws "Custom Id cannot contain :" rather than skipping the job, so a
 * bad id disables deduplication *and* the enqueue. These tests pin the format.
 */
describe('BullMQ job ids', () => {
  it('never contains the reserved delimiter', () => {
    expect(jobKey('purchase-snapshot', 'cms42xoc7001ua9wchk7cz6ds')).not.toContain(':');
    expect(jobKey('backfill', 'XAU', '2026-04-29', '2026-07-28')).not.toContain(':');
  });

  it('strips a delimiter embedded in a supplied part', () => {
    expect(jobKey('backfill', 'XAU', '2026-07-28T00:00:00Z')).toBe(
      'backfill-XAU-2026-07-28T00-00-00Z',
    );
  });

  it('stays stable for the same inputs so a repeat request dedupes', () => {
    expect(jobKey('backfill', 'XAU', '2026-04-29', '2026-07-28')).toBe(
      jobKey('backfill', 'XAU', '2026-04-29', '2026-07-28'),
    );
  });
});

function serviceWithQueue() {
  const add = vi.fn().mockResolvedValue({ id: 'job-1' });
  return { service: new PriceQueueService({ add } as never), add };
}

describe('enqueueing price work', () => {
  it('gives a purchase snapshot an id BullMQ accepts', async () => {
    const { service, add } = serviceWithQueue();

    await service.requestPurchaseSnapshot('cms42xoc7001ua9wchk7cz6ds');

    const [[name, , options]] = add.mock.calls as [[string, unknown, { jobId: string }]];
    expect(name).toBe(PriceJob.PurchaseSnapshot);
    expect(options.jobId).not.toContain(':');
    expect(options.jobId).toContain('cms42xoc7001ua9wchk7cz6ds');
  });

  it('does not let a queue outage fail the purchase that triggered it', async () => {
    const add = vi.fn().mockRejectedValue(new Error('redis unreachable'));
    const service = new PriceQueueService({ add } as never);

    // The purchase has already committed; reconciliation will catch this up.
    await expect(service.requestPurchaseSnapshot('purchase-1')).resolves.toBeUndefined();
  });

  it('keys a backfill by metal and range, normalizing the dates', async () => {
    const { service, add } = serviceWithQueue();

    const { jobId } = await service.requestBackfill(
      'xau',
      new Date('2026-04-29T00:00:00.000Z'),
      new Date('2026-07-28T23:59:59.000Z'),
    );

    expect(jobId).toBe('backfill-XAU-2026-04-29-2026-07-28');
    const [[name, payload]] = add.mock.calls as [[string, { metalCode: string; fromIso: string }]];
    expect(name).toBe(PriceJob.BackfillHistory);
    expect(payload.metalCode).toBe('XAU');
    expect(payload.fromIso).toBe('2026-04-29T00:00:00.000Z');
  });

  it('surfaces a backfill enqueue failure, unlike the fire-and-forget snapshot', async () => {
    const add = vi.fn().mockRejectedValue(new Error('redis unreachable'));
    const service = new PriceQueueService({ add } as never);

    // A user asked for this one and is waiting on the response.
    await expect(service.requestBackfill('XAU', new Date(), new Date())).rejects.toThrow(
      'redis unreachable',
    );
  });
});
