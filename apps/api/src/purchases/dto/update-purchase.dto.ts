import { IsOptional, IsString, MaxLength } from 'class-validator';

import { IsCurrencyCodeValue } from '../../common/decorators/validators.js';

/**
 * Transaction metadata a buyer can correct after the fact.
 *
 * Deliberately excluded: `purchasedAt`, every amount, and the allocation
 * method. Those are inputs to the committed allocation and to the purchase-time
 * spot snapshot (PRD §9) — what you paid over melt on a given day is a
 * historical fact, so changing them here would silently invalidate stored
 * results. Correcting them belongs in a re-entry flow that recomputes both.
 *
 * `currency` is the exception: picking the wrong one at entry mislabels amounts
 * that were themselves correct. Changing it relabels the purchase and its
 * holdings without touching a single figure, then discards and re-requests the
 * purchase-time snapshot, which was computed against the old currency.
 *
 * An empty string clears the field.
 */
export class UpdatePurchaseDto {
  @IsOptional()
  @IsCurrencyCodeValue()
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  dealerName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  branch?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  orderNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  invoiceNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  paymentMethod?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export const UPDATABLE_PURCHASE_FIELDS = [
  'dealerName',
  'branch',
  'orderNumber',
  'invoiceNumber',
  'paymentMethod',
  'notes',
] as const satisfies readonly (keyof UpdatePurchaseDto)[];
