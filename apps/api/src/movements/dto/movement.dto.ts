import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { WEIGHT_UNITS } from '@bullion-ledger/shared';

import { IsWeightUnitValue } from '../../common/decorators/validators.js';

const MONEY_RE = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
const METAL_CODE_RE = /^[A-Za-z]{3,8}$/;
const WEIGHT_RE = /^(?:0|[1-9]\d{0,8})(?:\.\d{1,9})?$/;
const PURITY_RE = /^(?:0(?:\.\d{1,7})?|1(?:\.0{1,7})?)$/;

/** Fields shared by every movement that removes metal from a holding. */
class DisposalBaseDto {
  @Type(() => Date)
  @IsDate({ message: 'occurredAt must be an ISO 8601 date-time' })
  occurredAt!: Date;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  counterparty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  /** Optimistic concurrency guard from the holding the user was viewing. */
  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class SellAssetDto extends DisposalBaseDto {
  @IsString()
  @Matches(MONEY_RE, { message: 'proceedsAmount must be a non-negative amount' })
  proceedsAmount!: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_RE, { message: 'fees must be a non-negative amount' })
  fees?: string;
}

export class GiftOutAssetDto extends DisposalBaseDto {}

export class LoseAssetDto extends DisposalBaseDto {}

/** Metal received as a gift — an acquisition with no purchase price. */
export class GiftInDto {
  @Type(() => Date)
  @IsDate({ message: 'occurredAt must be an ISO 8601 date-time' })
  occurredAt!: Date;

  @IsString()
  @Matches(METAL_CODE_RE, { message: 'metalCode must be a 3-8 letter code such as XAU' })
  metalCode!: string;

  @IsString()
  @MaxLength(128)
  name!: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  @IsString()
  @Matches(WEIGHT_RE, { message: 'unitWeight must be a non-negative decimal' })
  unitWeight!: string;

  @IsWeightUnitValue({ message: `weightUnit must be one of ${WEIGHT_UNITS.join(' | ')}` })
  weightUnit!: string;

  @IsString()
  @Matches(PURITY_RE, { message: 'purity must be a decimal fraction between 0 and 1' })
  purity!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  counterparty?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  storageLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  serial?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class TransferStorageDto {
  @Type(() => Date)
  @IsDate({ message: 'occurredAt must be an ISO 8601 date-time' })
  occurredAt!: Date;

  @IsString()
  @MaxLength(128)
  toStorageLocation!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
