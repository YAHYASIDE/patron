import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Keyset (cursor) pagination.
 *
 * OFFSET pagination re-scans every skipped row: page 5,000 of a 1M-row table
 * reads 100,000 rows to return 20, and gets linearly worse. A keyset query is a
 * range scan on an index and costs the same at page 1 and page 50,000.
 *
 * It also cannot skip or duplicate rows when data is inserted mid-pagination,
 * which OFFSET does routinely on a busy table.
 */
export class CursorDto {
  /** Opaque; encodes the sort key of the last row of the previous page. */
  @IsOptional() @IsString()
  cursor?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit = 20;

  @IsOptional() @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'desc';
}

export interface CursorPage<T> {
  data: T[];
  meta: { hasMore: boolean; nextCursor: string | null; limit: number };
}

/** Cursors are base64 so clients treat them as opaque and do not build them. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
    const createdAt = new Date(iso);
    if (!id || Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

/**
 * Build the `where` clause for the page after `cursor`.
 *
 * The compound (createdAt, id) comparison is what makes this correct: ordering
 * by timestamp alone is ambiguous when two rows share a millisecond, and the
 * ambiguity shows up as a row appearing on two consecutive pages.
 */
export function cursorWhere(cursor: string | undefined, order: 'asc' | 'desc') {
  if (!cursor) return {};
  const decoded = decodeCursor(cursor);
  if (!decoded) return {};

  const op = order === 'desc' ? 'lt' : 'gt';
  return {
    OR: [
      { createdAt: { [op]: decoded.createdAt } },
      { createdAt: decoded.createdAt, id: { [op]: decoded.id } },
    ],
  };
}

/** Fetch limit+1, then use the extra row to answer `hasMore` without a COUNT. */
export function toCursorPage<T extends { id: string; createdAt: Date }>(
  rows: T[],
  limit: number,
): CursorPage<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];

  return {
    data,
    meta: {
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
      limit,
    },
  };
}
