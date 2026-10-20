import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductAvailability } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUrl, Length,
  Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';

import {
  AVAILABILITIES, DECISION_ACTIONS, METHOD_KINDS, MarketDecisionAction, MarketMethodInput, MarketRuleInput,
  MarketRuleScope, MarketSource, RULE_SCOPES,
} from '../markets.types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const upperEach = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim().toUpperCase() : v)) : value;
const lowerEach = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v)) : value;
/** "+223" and "223" are the same dial code; it is stored without the plus. */
const dial = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/^\+/, '') : value);

const COUNTRY = /^[A-Z]{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const LANGUAGE = /^[a-z]{2,3}$/;
const DIAL = /^[0-9]{1,4}$/;
/** orange-money-ml, wave-sn, gc-apple-us */
const KEY = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export class CreateMarketDto {
  @ApiProperty({ example: 'SN', description: 'ISO 3166-1 alpha-2' })
  @Transform(upper) @IsString() @Matches(COUNTRY) code!: string;

  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) nameAr!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) nameFr!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) nameEn!: string;

  @ApiProperty({ example: 'XOF', description: 'The default paying currency' })
  @Transform(upper) @IsString() @Matches(CURRENCY) currency!: string;

  @ApiPropertyOptional({ type: [String], description: 'Other accepted currencies (the default is added first)' })
  @IsOptional() @Transform(upperEach) @IsArray() @ArrayMaxSize(10) @Matches(CURRENCY, { each: true }) currencies?: string[];

  @ApiPropertyOptional({ type: [String], example: ['fr', 'wo'] })
  @IsOptional() @Transform(lowerEach) @IsArray() @ArrayMaxSize(10) @Matches(LANGUAGE, { each: true }) languages?: string[];

  @ApiProperty({ example: '221', description: 'International dialling code, without the plus' })
  @Transform(dial) @IsString() @Matches(DIAL) dialCode!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateMarketDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 80) nameAr?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 80) nameFr?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Length(1, 80) nameEn?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(upper) @IsString() @Matches(CURRENCY) currency?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @Transform(upperEach) @IsArray() @ArrayMaxSize(10) @Matches(CURRENCY, { each: true }) currencies?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @Transform(lowerEach) @IsArray() @ArrayMaxSize(10) @Matches(LANGUAGE, { each: true }) languages?: string[];

  @ApiPropertyOptional() @IsOptional() @Transform(dial) @IsString() @Matches(DIAL) dialCode?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notes?: string;

  @ApiPropertyOptional({ description: 'Show the country in the store' })
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class MarketSourceDto implements MarketSource {
  @ApiProperty() @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) @MaxLength(500) url!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) title!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) publisher?: string;
  @ApiProperty({ description: 'When the page was read (ISO 8601)' }) @IsISO8601() accessedAt!: string;
}

abstract class ResearchedDto {
  @ApiProperty({ type: [MarketSourceDto], description: 'At least one source: a fact without one is not recorded' })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => MarketSourceDto)
  sources!: MarketSourceDto[];

  @ApiProperty({ minimum: 0, maximum: 100 })
  @Type(() => Number) @IsInt() @Min(0) @Max(100) confidence!: number;

  @ApiProperty({ example: 'market-scout' })
  @Transform(trim) @IsString() @Length(1, 80) verifiedBy!: string;
}

export class MarketMethodItemDto extends ResearchedDto implements MarketMethodInput {
  @ApiProperty({ example: 'orange-money-ml' })
  @Transform(trim) @IsString() @Matches(KEY) key!: string;

  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) provider?: string;

  @ApiProperty({ enum: METHOD_KINDS }) @IsIn(METHOD_KINDS) kind!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(upper) @IsString() @Matches(CURRENCY) currency?: string;
  @ApiPropertyOptional({ description: 'As the source states them' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) fees?: string;
  @ApiPropertyOptional({ description: 'What the research could not confirm' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

export class UpsertMethodsDto {
  @ApiProperty({ type: [MarketMethodItemDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => MarketMethodItemDto)
  items!: MarketMethodItemDto[];
}

export class MarketRuleItemDto extends ResearchedDto implements MarketRuleInput {
  @ApiProperty({ enum: RULE_SCOPES }) @IsIn(RULE_SCOPES) scope!: MarketRuleScope;

  @ApiProperty({ description: 'sku, brand key or category slug', example: 'gc-apple-us' })
  @Transform(trim) @IsString() @Length(1, 120) ref!: string;

  @ApiProperty({ enum: AVAILABILITIES }) @IsIn(AVAILABILITIES) availability!: ProductAvailability;

  @ApiPropertyOptional({ maxLength: 300 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(300) note?: string;
}

export class UpsertRulesDto {
  @ApiProperty({ type: [MarketRuleItemDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => MarketRuleItemDto)
  items!: MarketRuleItemDto[];
}

export class MarketDecisionDto {
  @ApiProperty({ enum: DECISION_ACTIONS }) @IsIn(DECISION_ACTIONS) action!: MarketDecisionAction;
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @Transform(trim) @IsString() @MaxLength(500) note?: string;
}

export class LinkAccountDto {
  @ApiProperty({ description: 'The id of one of the manual accounts in Payment methods' })
  @Transform(trim) @IsString() @Length(1, 100) accountId!: string;
}
