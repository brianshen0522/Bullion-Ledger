import {
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
}
