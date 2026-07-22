import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Permissions are a fixed catalogue owned by the codebase and installed by
   * the seed — there is deliberately no create/update/delete API. Adding one
   * is a code change, so the guards and the database can never drift apart.
   */
  async findAllGrouped() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { key: 'asc' }],
    });

    return permissions.reduce<Record<string, typeof permissions>>((acc, p) => {
      (acc[p.module] ??= []).push(p);
      return acc;
    }, {});
  }
}
