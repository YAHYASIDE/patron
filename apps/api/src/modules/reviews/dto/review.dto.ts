import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateReviewDto {
  @ApiProperty() @IsUUID() orderItemId!: string;

  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt() @Min(1) @Max(5) rating!: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

export class PublicReviewsQueryDto {
  @ApiProperty({ description: 'Comma-separated product ids (a brand\'s amounts)', example: 'uuid1,uuid2' })
  @IsString() @MaxLength(4_000) productIds!: string;
}

export class AdminReviewsQueryDto {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional() @IsIn(['true', 'false']) published?: 'true' | 'false';
}

export class UpdateReviewDto {
  @ApiPropertyOptional({ description: 'false hides the review from the store' })
  @IsOptional() @IsBoolean() isPublished?: boolean;

  @ApiPropertyOptional({ maxLength: 1000, nullable: true, description: 'The shop\'s answer; null or empty removes it' })
  @IsOptional() @IsString() @MaxLength(1000) reply?: string | null;
}
