import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { METHOD_KINDS, MarketRuleScope, RULE_SCOPES } from '../../markets/markets.types';
import { ProductAvailability } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUrl, Length, Matches, Max,
  MaxLength, Min, ValidateNested, ValidationArguments, ValidationOptions, registerDecorator,
} from 'class-validator';

import {
  DECISION_ACTIONS, DISCOVERY_KINDS, DecisionAction, DiscoveryKind, EVIDENCE_TYPES, RUN_STATUSES, RUN_TRIGGERS, RunStatus,
  RunTrigger, SEVERITIES, TABS, Tab,
} from '../intelligence.types';

/** Most discoveries one ingest call may carry. */
export const MAX_INGEST_DISCOVERIES = 200;
export const MAX_MARKET_ITEMS = 200;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** A JSON object whose serialised size stays under `max` characters. */
function JsonSizeAtMost(max: number, options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'jsonSizeAtMost',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options: { message: (a: ValidationArguments) => `${a.property} must be at most ${max} characters of JSON`, ...options },
      validator: {
        validate: (value: unknown) => {
          try {
            return JSON.stringify(value ?? null).length <= max;
          } catch {
            return false;
          }
        },
      },
    });
}

// ─────────────── queries ───────────────

export class DiscoveriesQueryDto {
  @ApiPropertyOptional({ enum: TABS, default: 'all' })
  @IsOptional() @IsIn(TABS) tab?: Tab;

  @ApiPropertyOptional({ enum: DISCOVERY_KINDS })
  @IsOptional() @IsIn(DISCOVERY_KINDS) kind?: DiscoveryKind;

  @ApiPropertyOptional({ enum: SEVERITIES })
  @IsOptional() @IsIn(SEVERITIES) severity?: (typeof SEVERITIES)[number];

  @ApiPropertyOptional({ maxLength: 100, description: 'Searches the title, the description and the fingerprint' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 30 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;

  @ApiPropertyOptional({ description: 'nextCursor of the previous page' })
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

export class LimitQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class AgentRunsQueryDto extends LimitQueryDto {
  @ApiPropertyOptional({ description: 'An agent name, e.g. scanner:search-gaps' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(64) agent?: string;
}

// ─────────────── decisions ───────────────

export class DiscoveryDecisionDto {
  @ApiProperty({ enum: DECISION_ACTIONS })
  @IsIn(DECISION_ACTIONS) action!: DecisionAction;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) note?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 365, default: 7, description: 'defer only' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) deferDays?: number;
}

// ─────────────── ingest ───────────────

export class EvidenceDto {
  @ApiProperty({ enum: EVIDENCE_TYPES })
  @IsIn(EVIDENCE_TYPES) type!: (typeof EVIDENCE_TYPES)[number];

  @ApiProperty({ maxLength: 500 })
  @IsString() @Length(1, 500) ref!: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional() @IsString() @MaxLength(1000) detail?: string;
}

/** Fingerprints are keys, not text: letters, digits and a few separators. */
export const FINGERPRINT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@#-]{0,199}$/;

export class DiscoveryInputDto {
  @ApiProperty({ example: 'payments.account-no-number:bankily', description: 'One per subject; seeing it again updates the row' })
  @Transform(trim) @IsString() @Matches(FINGERPRINT_PATTERN) fingerprint!: string;

  @ApiProperty({ enum: DISCOVERY_KINDS })
  @Transform(lower) @IsIn(DISCOVERY_KINDS) kind!: DiscoveryKind;

  @ApiProperty({ maxLength: 200 })
  @Transform(trim) @IsString() @Length(1, 200) title!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString() @Length(1, 4000) description!: string;

  @ApiProperty({ type: [EvidenceDto] })
  @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => EvidenceDto) evidence!: EvidenceDto[];

  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsInt() @Min(0) @Max(100) confidence!: number;

  @ApiProperty({ description: 'false = a hypothesis to check' })
  @IsBoolean() verified!: boolean;

  @ApiProperty({ enum: SEVERITIES })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsIn(SEVERITIES) severity!: (typeof SEVERITIES)[number];

  @ApiProperty({ maxLength: 1000 })
  @IsString() @Length(1, 1000) impact!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString() @Length(1, 4000) proposal!: string;

  @ApiPropertyOptional({ type: Object, description: 'Free-form, at most 4000 characters of JSON' })
  @IsOptional() @IsObject() @JsonSizeAtMost(4000) testResults?: Record<string, unknown>;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional() @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9._/-]{1,200}$/) branch?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(500) prUrl?: string;
}

export class TestsDto {
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) passed!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(1_000_000) failed!: number;
}

export class MarketSourceDto {
  @ApiProperty() @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) @MaxLength(500) url!: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 200) title!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) publisher?: string;
  @ApiProperty() @IsISO8601() accessedAt!: string;
}


export class MarketMethodDto {
  @ApiProperty({ example: 'orange-money-ml' })
  @Transform(lower) @IsString() @Matches(/^[a-z0-9][a-z0-9-]{1,63}$/) key!: string;

  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) name!: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) provider?: string;

  @ApiProperty({ enum: METHOD_KINDS })
  @Transform(lower) @IsIn(METHOD_KINDS) kind!: string;

  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/) currency?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) fees?: string;

  @ApiProperty({ type: [MarketSourceDto] })
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => MarketSourceDto) sources!: MarketSourceDto[];

  @ApiProperty() @IsInt() @Min(0) @Max(100) confidence!: number;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 64) verifiedBy!: string;
}

export class MarketRuleDto {
  @ApiProperty({ enum: RULE_SCOPES })
  @Transform(lower) @IsIn(RULE_SCOPES) scope!: MarketRuleScope;

  @ApiProperty() @Transform(trim) @IsString() @Length(1, 120) ref!: string;

  @ApiProperty({ enum: ProductAvailability })
  @IsIn(Object.values(ProductAvailability)) availability!: ProductAvailability;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;

  @ApiProperty({ type: [MarketSourceDto] })
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => MarketSourceDto) sources!: MarketSourceDto[];

  @ApiProperty() @IsInt() @Min(0) @Max(100) confidence!: number;
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 64) verifiedBy!: string;
}

export class MarketIngestDto {
  @ApiProperty({ example: 'ML' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{2}$/) code!: string;

  @ApiPropertyOptional({ type: [MarketMethodDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_MARKET_ITEMS) @ValidateNested({ each: true }) @Type(() => MarketMethodDto)
  methods?: MarketMethodDto[];

  @ApiPropertyOptional({ type: [MarketRuleDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_MARKET_ITEMS) @ValidateNested({ each: true }) @Type(() => MarketRuleDto)
  rules?: MarketRuleDto[];
}

/** `ok`/`failed`/`running` are accepted for the schema's SUCCEEDED/FAILED/RUNNING. */
const runStatus = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const v = value.trim().toUpperCase();
  return v === 'OK' ? 'SUCCEEDED' : v;
};

export class IngestDto {
  @ApiProperty({ example: 'discovery-engine' })
  @Transform(lower) @IsString() @Matches(/^[a-z0-9][a-z0-9:._-]{0,63}$/) agent!: string;

  @ApiProperty({ enum: RUN_TRIGGERS })
  @Transform(lower) @IsIn(RUN_TRIGGERS) trigger!: RunTrigger;

  @ApiProperty({ enum: RUN_STATUSES })
  @Transform(runStatus) @IsIn(RUN_STATUSES) status!: RunStatus;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional() @IsString() @MaxLength(2000) summary?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(lower) @Matches(/^[0-9a-f]{7,40}$/) commit?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @Matches(/^[A-Za-z0-9._/-]{1,200}$/) branch?: string;

  @ApiPropertyOptional({ type: TestsDto })
  @IsOptional() @ValidateNested() @Type(() => TestsDto) tests?: TestsDto;

  @ApiPropertyOptional({ type: [DiscoveryInputDto], maxItems: MAX_INGEST_DISCOVERIES })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_INGEST_DISCOVERIES) @ValidateNested({ each: true }) @Type(() => DiscoveryInputDto)
  discoveries?: DiscoveryInputDto[];

  @ApiPropertyOptional({ type: MarketIngestDto })
  @IsOptional() @ValidateNested() @Type(() => MarketIngestDto) market?: MarketIngestDto;
}
