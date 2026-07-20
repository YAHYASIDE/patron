import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { paginate } from '../../common/dto/pagination.dto';
import { AdminUpdateUserDto, BlockUserDto, CreateUserDto, QueryUsersDto, UpdateUserDto } from './dto/user.dto';
import { toAuditJson } from '../../common/audit/audit.service';

const PUBLIC_FIELDS = {
  id: true, email: true, phone: true, fullName: true, avatarUrl: true,
  locale: true, defaultCurrency: true, isActive: true, isBlocked: true,
  emailVerifiedAt: true, lastLoginAt: true, createdAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  async findAll(query: QueryUsersDto) {
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.isActive !== undefined && { isActive: query.isActive }),
      ...(query.isBlocked !== undefined && { isBlocked: query.isBlocked }),
      ...(query.role && { roles: { some: { role: { name: query.role } } } }),
      ...(query.search && {
        OR: [
          { email: { contains: query.search, mode: 'insensitive' } },
          { fullName: { contains: query.search, mode: 'insensitive' } },
          { phone: { contains: query.search } },
        ],
      }),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: { ...PUBLIC_FIELDS, roles: { select: { role: { select: { id: true, name: true } } } } },
        skip: query.skip,
        take: query.limit,
        orderBy: { createdAt: query.order },
      }),
      this.prisma.user.count({ where }),
    ]);

    return paginate(
      data.map(({ roles, ...u }) => ({ ...u, roles: roles.map((r) => r.role) })),
      total,
      query,
    );
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: {
        ...PUBLIC_FIELDS,
        roles: { select: { role: { select: { id: true, name: true } } } },
        wallets: { select: { currencyCode: true, balance: true } },
        _count: { select: { orders: true } },
      },
    });
    if (!user) throw new NotFoundException('User not found');

    const { roles, ...rest } = user;
    return { ...rest, roles: roles.map((r) => r.role) };
  }

  async create(dto: CreateUserDto, actorId: string) {
    const currency = dto.defaultCurrency ?? 'USD';
    const roleIds = dto.roleIds?.length
      ? dto.roleIds
      : [(await this.prisma.role.findUniqueOrThrow({ where: { name: 'customer' } })).id];

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email.toLowerCase().trim(),
          phone: dto.phone,
          fullName: dto.fullName.trim(),
          passwordHash: await this.crypto.hashPassword(dto.password),
          defaultCurrency: currency,
          roles: { create: roleIds.map((roleId) => ({ roleId })) },
          wallets: { create: { currencyCode: currency } },
        },
        select: PUBLIC_FIELDS,
      });

      await tx.auditLog.create({
        data: { userId: actorId, action: 'users.create', entityType: 'User', entityId: user.id, after: toAuditJson(user) },
      });
      return user;
    });
  }

  /** Self-service profile update — cannot touch roles or status. */
  updateProfile(userId: string, dto: UpdateUserDto) {
    return this.prisma.user.update({ where: { id: userId }, data: dto, select: PUBLIC_FIELDS });
  }

  async adminUpdate(id: string, dto: AdminUpdateUserDto, actorId: string) {
    const before = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: { ...PUBLIC_FIELDS, roles: { select: { roleId: true } } },
    });
    if (!before) throw new NotFoundException('User not found');

    const { roleIds, ...scalars } = dto;

    return this.prisma.$transaction(async (tx) => {
      if (roleIds) {
        await tx.userRole.deleteMany({ where: { userId: id } });
        await tx.userRole.createMany({ data: roleIds.map((roleId) => ({ userId: id, roleId })) });
      }
      const after = await tx.user.update({ where: { id }, data: scalars, select: PUBLIC_FIELDS });

      await tx.auditLog.create({
        data: {
          userId: actorId, action: 'users.update', entityType: 'User', entityId: id,
          before: toAuditJson(before), after: toAuditJson(after),
        },
      });
      return after;
    });
  }

  async setBlocked(id: string, dto: BlockUserDto, actorId: string) {
    if (id === actorId) throw new ForbiddenException('You cannot block your own account');

    const user = await this.prisma.user.findFirst({
      where: { id, deletedAt: null },
      include: { roles: { include: { role: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.roles.some((r) => r.role.name === 'super_admin')) {
      throw new ForbiddenException('Super admins cannot be blocked');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id },
        data: { isBlocked: dto.blocked },
        select: PUBLIC_FIELDS,
      });
      // Blocking must kill live sessions, not just future logins.
      if (dto.blocked) {
        await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await tx.auditLog.create({
        data: {
          userId: actorId,
          action: dto.blocked ? 'users.block' : 'users.unblock',
          entityType: 'User', entityId: id,
          after: toAuditJson({ blocked: dto.blocked, reason: dto.reason }),
        },
      });
      return updated;
    });
  }

  async remove(id: string, actorId: string) {
    if (id === actorId) throw new ForbiddenException('You cannot delete your own account');

    const openOrders = await this.prisma.order.count({
      where: { userId: id, status: { in: ['PENDING_PAYMENT', 'PAID', 'PROCESSING'] } },
    });
    if (openOrders > 0) throw new BadRequestException(`User has ${openOrders} open order(s)`);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
      this.prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: { userId: actorId, action: 'users.delete', entityType: 'User', entityId: id },
      }),
    ]);
    return { message: 'User deleted' };
  }
}
