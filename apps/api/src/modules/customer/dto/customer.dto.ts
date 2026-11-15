import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class SavedInputsQueryDto {
  @ApiPropertyOptional({ description: 'Only the values saved for this game' })
  @IsOptional() @IsUUID() gameId?: string;
}

export class SaveInputDto {
  @ApiProperty() @IsUUID() gameId!: string;

  @ApiPropertyOptional({ maxLength: 40, example: 'حسابي' })
  @IsOptional() @IsString() @MaxLength(40) label?: string;

  @ApiProperty({ example: { playerId: '5123456789' }, description: '{ <input key>: <value> }' })
  @IsObject() values!: Record<string, unknown>;
}

export const WATCH_KINDS = ['price', 'stock'] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

export class CreateWatchDto {
  @ApiProperty() @IsUUID() productId!: string;

  @ApiProperty({ enum: WATCH_KINDS })
  @IsIn(WATCH_KINDS) kind!: WatchKind;
}

export class BestSellersQueryDto {
  @ApiPropertyOptional({ default: 8, maximum: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit?: number;
}
