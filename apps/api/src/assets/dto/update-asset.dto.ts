import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MONEY_INPUT_RE, PURITY_INPUT_RE, WEIGHT_INPUT_RE } from '@bullion-ledger/shared';
import { IsWeightUnitValue } from '../../common/decorators/validators.js';

export class UpdateAssetDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity?: number;

  @IsOptional()
  @IsString()
  @Matches(WEIGHT_INPUT_RE)
  unitWeight?: string;

  @IsOptional()
  @IsWeightUnitValue()
  weightUnit?: string;

  /** Purity ratio in (0, 1]. */
  @IsOptional()
  @IsString()
  @Matches(PURITY_INPUT_RE)
  purity?: string;

  @ValidateIf((o) => o.allocatedCost !== undefined)
  @IsString()
  @Matches(MONEY_INPUT_RE)
  allocatedCost?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  serial?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  storageLocation?: string | null;

  /**
   * Descriptive overrides for this one holding. A supplied empty string or null
   * clears the override and restores the inherited catalog / purchase value.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  form?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  brand?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  country?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  yearOrVersion?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  packagingState?: string | null;

  @IsOptional()
  @IsBoolean()
  hasCertificate?: boolean;
}
