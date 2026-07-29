import { describe, expect, it } from 'vitest';

import { createPurchaseWizardDraft } from '../src/purchase-wizard/model.js';
import { selectInitialDraft, type PurchaseIntake } from '../src/screens/Purchase.js';

function intakeFor(draft: ReturnType<typeof createPurchaseWizardDraft>): PurchaseIntake {
  return {
    id: draft.draftId,
    status: 'DRAFT',
    currentStep: 1,
    schemaVersion: draft.version,
    version: 7,
    updatedAt: draft.updatedAt,
    draftData: JSON.parse(JSON.stringify(draft)) as Record<string, unknown>,
    attachments: [],
  };
}

describe('cross-device purchase draft selection', () => {
  it('uses newer server content instead of overwriting it with stale local data', () => {
    const local = createPurchaseWizardDraft({ draftId: 'draft-shared', itemId: 'item-shared' });
    local.items[0]!.name = 'stale local';
    local.updatedAt = '2026-07-28T10:00:00.000Z';
    const server = structuredClone(local);
    server.items[0]!.name = 'newer server';
    server.updatedAt = '2026-07-28T11:00:00.000Z';

    const selected = selectInitialDraft([intakeFor(server)], local);

    expect(selected.draft?.items[0]?.name).toBe('newer server');
    expect(selected.intake?.version).toBe(7);
  });

  it('keeps a genuinely newer local edit while retaining the server OCC reference', () => {
    const server = createPurchaseWizardDraft({ draftId: 'draft-shared', itemId: 'item-shared' });
    server.items[0]!.name = 'server';
    server.updatedAt = '2026-07-28T10:00:00.000Z';
    const local = structuredClone(server);
    local.items[0]!.name = 'newer local';
    local.updatedAt = '2026-07-28T11:00:00.000Z';

    const selected = selectInitialDraft([intakeFor(server)], local);

    expect(selected.draft?.items[0]?.name).toBe('newer local');
    expect(selected.intake?.version).toBe(7);
  });
});
