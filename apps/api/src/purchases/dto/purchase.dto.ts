import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AttributionStatus, OrganizationRole } from '@prisma/client';
import {
  MAX_ALLOCATION_ITEMS,
  MONEY_INPUT_RE,
  PURITY_INPUT_RE,
  WEIGHT_INPUT_RE,
} from '@bullion-ledger/shared';

import {
  IsAllocationMethodValue,
  IsCurrencyCodeValue,
  IsWeightUnitValue,
} from '../../common/decorators/validators.js';

const METAL_CODE_RE = /^[A-Z][A-Z0-9]{1,7}$/;
const NON_BLANK_RE = /\S/;

export class PurchaseItemOrganizationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  organizationId?: string;

  @IsEnum(OrganizationRole)
  role!: OrganizationRole;

  /** Used only for an unlinked, user-reported organization. */
  @IsOptional()
  @IsString()
  @Matches(NON_BLANK_RE)
  @MaxLength(160)
  displayName?: string;

  @IsOptional()
  @IsEnum(AttributionStatus)
  attributionStatus?: AttributionStatus;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class PurchaseItemDto {
  /** Stable client-side wizard item id used only to reassign intake photos. */
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  draftItemId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  productDefinitionId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  productDefinitionVersion?: number;

  @IsString()
  @IsNotEmpty()
  @Matches(METAL_CODE_RE)
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

  @IsString()
  @IsNotEmpty()
  @Matches(NON_BLANK_RE)
  @MaxLength(128)
  name!: string;

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
  @MaxLength(128)
  serial?: string;

  @IsInt()
  @Min(1)
  @Max(1_000_000)
  quantity!: number;

  /** Unit-weight magnitude as a string to preserve Decimal precision. */
  @IsString()
  @Matches(WEIGHT_INPUT_RE)
  unitWeight!: string;

  @IsWeightUnitValue()
  weightUnit!: string;

  /** Purity ratio in (0, 1]. */
  @IsString()
  @Matches(PURITY_INPUT_RE)
  purity!: string;

  /** Per-line metal subtotal used as proportional-allocation basis. */
  @IsString()
  @Matches(MONEY_INPUT_RE)
  lineSubtotal!: string;

  /** Required when purchase.allocationMethod === MANUAL. */
  @IsOptional()
  @IsString()
  @Matches(MONEY_INPUT_RE)
  manualAmount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  packagingState?: string;

  @IsOptional()
  @IsBoolean()
  hasCertificate?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  initialStorageLocation?: string;

  /** Custom-item parties. Catalog product parties are resolved server-side. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemOrganizationDto)
  parties?: PurchaseItemOrganizationDto[];
}

export class PurchaseDto {
  @IsDateString()
  purchasedAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  dealerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  branch?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  orderNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  invoiceNumber?: string;

  @IsCurrencyCodeValue()
  currency!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  paymentMethod?: string;

  @IsString()
  @Matches(MONEY_INPUT_RE)
  subtotal!: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_INPUT_RE)
  premium?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_INPUT_RE)
  labor?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_INPUT_RE)
  tax?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_INPUT_RE)
  shipping?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_INPUT_RE)
  otherFees?: string;

  @IsOptional()
  @IsString()
  @Matches(MONEY_INPUT_RE)
  discount?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  @IsAllocationMethodValue()
  allocationMethod!: string;

  /**
   * Optional so existing clients keep working; absent means the caller used the
   * fully itemized form, which is what every pre-existing purchase did.
   */
  @IsOptional()
  @IsIn(['SIMPLE', 'ITEMIZED'], { message: 'priceEntryMode must be SIMPLE or ITEMIZED' })
  priceEntryMode?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ALLOCATION_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];
}
