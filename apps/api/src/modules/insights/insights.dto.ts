import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

export class OverviewQueryDto {
  /** A product with code stock is "low" at this many available codes or fewer. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000)
  lowStock = 3;

  /** Target margin, in percent: an active product under it is flagged. */
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100)
  margin = 5;
}
