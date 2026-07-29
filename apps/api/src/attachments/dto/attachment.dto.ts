import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsBooleanString,
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
import {
  AttachmentCaptureSource,
  AttachmentMediaClass,
  AttachmentProcessingMode,
  AttachmentVariantKind,
} from '@prisma/client';

const NON_BLANK_RE = /\S/;

export class UploadAttachmentQueryDto {
  @IsString()
  @Matches(NON_BLANK_RE)
  @MaxLength(64)
  kind!: string;

  @IsEnum(AttachmentMediaClass)
  mediaClass!: AttachmentMediaClass;

  @IsEnum(AttachmentCaptureSource)
  captureSource!: AttachmentCaptureSource;

  @IsOptional()
  @IsEnum(AttachmentProcessingMode)
  processingMode?: AttachmentProcessingMode;

  @IsOptional()
  @IsString()
  @Matches(NON_BLANK_RE)
  @MaxLength(128)
  draftItemId?: string;

  @IsOptional()
  @IsString()
  @Matches(NON_BLANK_RE)
  @MaxLength(128)
  clientMediaId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  /** Comma-separated tags; normalized and de-duplicated server-side. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  tags?: string;

  @IsOptional()
  @IsBooleanString()
  isSensitive?: string;

  @IsOptional()
  @IsBooleanString()
  isCover?: string;
}

export class ReviewAttachmentDto {
  /** Optimistic-concurrency token returned by the attachment presenter. */
  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @IsString()
  @Matches(NON_BLANK_RE)
  @MaxLength(64)
  kind?: string;

  @IsOptional()
  @IsEnum(AttachmentMediaClass)
  mediaClass?: AttachmentMediaClass;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  draftItemId?: string | null;

  @IsOptional()
  @IsEnum(AttachmentProcessingMode)
  processingMode?: AttachmentProcessingMode;

  @IsOptional()
  @IsObject()
  processingMetadata?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  userConfirmed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  tags?: string[];

  @IsOptional()
  @IsBoolean()
  isCover?: boolean;
}

export class AttachmentReadUrlQueryDto {
  @IsOptional()
  @IsEnum(AttachmentVariantKind)
  variant?: AttachmentVariantKind;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  revision?: number;
}

export class UploadAttachmentVariantQueryDto {
  @IsEnum(AttachmentVariantKind)
  kind!: AttachmentVariantKind;
}
