import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PRICE_SOURCE_TYPES, WEIGHT_UNITS } from '@bullion-ledger/shared';

import { IsWeightUnitValue } from '../../common/decorators/validators.js';

const METAL_CODE_RE = /^[A-Za-z]{3,8}$/;
const CURRENCY_RE = /^[A-Za-z]{3}$/;
/** Decimal string, kept as text so the value reaches Decimal unrounded. */
const PRICE_RE = /^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;

export class ManualPriceDto {
  @IsString()
  @Matches(METAL_CODE_RE, { message: 'metalCode must be a 3-8 letter code such as XAU' })
  metalCode!: string;

  @IsString()
  @Matches(PRICE_RE, { message: 'price must be a positive decimal with at most 6 decimal places' })
  price!: string;

  @IsString()
  @Matches(CURRENCY_RE, { message: 'quoteCurrency must be a 3-letter ISO code' })
  quoteCurrency!: string;

  @IsWeightUnitValue({ message: `quoteUnit must be one of ${WEIGHT_UNITS.join(' | ')}` })
  quoteUnit!: string;

  /** Defaults to now; supplied when backfilling a price the user looked up. */
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'timestamp must be an ISO 8601 date-time' })
  timestamp?: Date;

  /**
   * Defaults to MANUAL. Allows recording a dealer's posted price by hand
   * without it being mistaken for international spot (PRD §12.2).
   */
  @IsOptional()
  @IsString()
  @Matches(new RegExp(`^(${PRICE_SOURCE_TYPES.join('|')})$`), {
    message: `sourceType must be one of ${PRICE_SOURCE_TYPES.join(' | ')}`,
  })
  sourceType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class HistoryQueryDto {
  @IsString()
  @Matches(METAL_CODE_RE, { message: 'metal must be a 3-8 letter code such as XAU' })
  metal!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'from must be an ISO 8601 date-time' })
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'to must be an ISO 8601 date-time' })
  to?: Date;

  @IsOptional()
  @IsString()
  @Matches(new RegExp(`^(${PRICE_SOURCE_TYPES.join('|')})$`), {
    message: `sourceType must be one of ${PRICE_SOURCE_TYPES.join(' | ')}`,
  })
  sourceType?: string;
}

export class BackfillDto {
  @IsString()
  @Matches(METAL_CODE_RE, { message: 'metalCode must be a 3-8 letter code such as XAU' })
  metalCode!: string;

  @Type(() => Date)
  @IsDate({ message: 'from must be an ISO 8601 date-time' })
  from!: Date;

  @Type(() => Date)
  @IsDate({ message: 'to must be an ISO 8601 date-time' })
  to!: Date;
}

export class MarkerQueryDto {
  @IsString()
  @Matches(METAL_CODE_RE, { message: 'metal must be a 3-8 letter code such as XAU' })
  metal!: string;
}
