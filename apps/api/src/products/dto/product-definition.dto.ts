import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AttributionStatus, OrganizationRole } from '@prisma/client';
import { PURITY_INPUT_RE, WEIGHT_INPUT_RE } from '@bullion-ledger/shared';
import { IsWeightUnitValue } from '../../common/decorators/validators.js';

const METAL_CODE_RE = /^[A-Z][A-Z0-9]{1,7}$/;
const NON_BLANK_RE = /\S/;

export class ProductOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  organizationId!: string;

  @IsEnum(OrganizationRole)
  role!: OrganizationRole;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsEnum(AttributionStatus)
  attributionStatus?: AttributionStatus;
}

export class ProductDefinitionDto {
  @IsString()
  @IsNotEmpty()
  @Matches(NON_BLANK_RE)
  @MaxLength(128)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(METAL_CODE_RE)
  @MaxLength(64)
  metalCode!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(NON_BLANK_RE)
  @MaxLength(64)
  form!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  yearOrVersion?: string;

  /** Purity ratio in (0, 1]. Stored as Decimal. */
  @IsString()
  @Matches(PURITY_INPUT_RE)
  purity!: string;

  /** Unit weight magnitude (e.g. "31.1034768"). */
  @IsString()
  @Matches(WEIGHT_INPUT_RE)
  unitWeight!: string;

  @IsWeightUnitValue()
  weightUnit!: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  /** Structured product parties; free-text brand remains backwards-compatible. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ProductOrganizationDto)
  parties?: ProductOrganizationDto[];
}

/**
 * Partial update for an existing ProductDefinition. `metalCode` is identity
 * and therefore intentionally absent: it cannot be changed by editing. Only
 * fields present in the payload are applied, so unchanged weight/unit pairs
 * do not introduce rounding drift.
 */
export class UpdateProductDefinitionDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(NON_BLANK_RE)
  @MaxLength(128)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @Matches(NON_BLANK_RE)
  @MaxLength(64)
  form?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  yearOrVersion?: string;

  @IsOptional()
  @IsString()
  @Matches(PURITY_INPUT_RE)
  purity?: string;

  /** Unit-weight magnitude. Recomputes canonical grams only when present. */
  @IsOptional()
  @IsString()
  @Matches(WEIGHT_INPUT_RE)
  unitWeight?: string;

  @IsOptional()
  @IsWeightUnitValue()
  weightUnit?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => ProductOrganizationDto)
  parties?: ProductOrganizationDto[];
}
