import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * Offset pagination.
 *
 * Correct for bounded, admin-facing lists (roles, providers, currencies) where
 * the table will never be large and a page count is genuinely useful.
 *
 * NOT correct for orders, order items, notifications or audit logs. Postgres
 * satisfies `OFFSET 500000` by reading and discarding 500,000 rows — at a
 * million orders, page 25,000 is a table scan. Those endpoints use `CursorDto`
 * from `cursor.dto.ts`, which is the single keyset implementation.
 */
export class PaginationDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  page = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;

  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';

  get skip() {
    return (this.page - 1) * this.limit;
  }
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; pages: number };
}

export function paginate<T>(data: T[], total: number, dto: PaginationDto): Paginated<T> {
  return { data, meta: { page: dto.page, limit: dto.limit, total, pages: Math.ceil(total / dto.limit) } };
}
