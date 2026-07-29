import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PurchaseIntakeStatus } from '@prisma/client';
import { CLIENT_DRAFT_ID_PATTERN } from '@bullion-ledger/shared';

export class CreatePurchaseIntakeDto {
  @IsString()
  @Matches(CLIENT_DRAFT_ID_PATTERN)
  @MaxLength(128)
  draftId!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  currentStep?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  schemaVersion?: number;

  @IsOptional()
  @IsObject()
  draftData?: Record<string, unknown>;
}

export class UpdatePurchaseIntakeDto {
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  currentStep?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  schemaVersion?: number;

  @IsOptional()
  @IsObject()
  draftData?: Record<string, unknown>;
}

export class ListPurchaseIntakesQueryDto {
  @IsOptional()
  @IsEnum(PurchaseIntakeStatus)
  status?: PurchaseIntakeStatus;
}

export class PurchaseIntakeIdParamDto {
  @IsString()
  @Matches(CLIENT_DRAFT_ID_PATTERN)
  @MaxLength(128)
  id!: string;
}
