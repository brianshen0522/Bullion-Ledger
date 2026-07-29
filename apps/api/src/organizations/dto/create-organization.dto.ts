import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEnum,
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
import { CatalogSource, OrganizationAliasKind, OrganizationRole } from '@prisma/client';

const NON_BLANK_RE = /\S/;
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
const LOCALE_RE = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/;

export class CreateOrganizationAliasDto {
  @IsString()
  @IsNotEmpty()
  @Matches(NON_BLANK_RE)
  @MaxLength(160)
  name!: string;

  @IsEnum(OrganizationAliasKind)
  kind!: OrganizationAliasKind;

  @IsOptional()
  @IsString()
  @Matches(LOCALE_RE)
  @MaxLength(35)
  locale?: string;
}

export class CreateOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @Matches(NON_BLANK_RE)
  @MaxLength(160)
  canonicalName!: string;

  @IsOptional()
  @IsString()
  @Matches(COUNTRY_CODE_RE)
  countryCode?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ArrayUnique()
  @IsEnum(OrganizationRole, { each: true })
  capabilities?: OrganizationRole[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateOrganizationAliasDto)
  aliases?: CreateOrganizationAliasDto[];
}

export class OrganizationSearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  q?: string;

  /** Comma-delimited roles; every requested role must be present. */
  @IsOptional()
  @IsString()
  @MaxLength(160)
  capabilities?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export interface OrganizationAliasResultDto {
  id: string;
  name: string;
  kind: OrganizationAliasKind;
  locale: string | null;
}

/** Public search shape. Internal normalized names never leave the API. */
export interface OrganizationSearchResultDto {
  id: string;
  canonicalName: string;
  countryCode: string | null;
  source: CatalogSource;
  verified: boolean;
  active: boolean;
  aliases: OrganizationAliasResultDto[];
  capabilities: OrganizationRole[];
  /** Alias whose exact/prefix/substring match outranked the canonical name. */
  matchedAlias: string | null;
}
