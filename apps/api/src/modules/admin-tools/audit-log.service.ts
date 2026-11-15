import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { cursorWhere, toCursorPage } from '../../common/dto/cursor.dto';
import { AuditQueryDto } from './admin-tools.dto';

/**
 * Activity log (#46): who changed what. Only the headline of each entry; the
 * before/after snapshots stay in the table (already redacted by AuditService).
 */
@Injectable()
export class AuditLogService {
  constructor(private prisma: PrismaService) {}

  async list(query: AuditQueryDto) {
    const where: Prisma.AuditLogWhereInput = {
      ...(query.entityType && { entityType: query.entityType }),
      ...(query.action && { action: { startsWith: query.action } }),
      ...cursorWhere(query.cursor, query.order),
    };

    const rows = await this.prisma.auditLog.findMany({
      where,
      take: query.limit + 1,
      orderBy: [{ createdAt: query.order }, { id: query.order }],
      select: {
        id: true, action: true, entityType: true, entityId: true, createdAt: true,
        user: { select: { fullName: true, email: true } },
      },
    });

    const page = toCursorPage(rows, query.limit);
    return {
      ...page,
      data: page.data.map(({ user, ...r }) => ({ ...r, actor: user ?? null })),
      nextCursor: page.meta.nextCursor,
    };
  }
}
