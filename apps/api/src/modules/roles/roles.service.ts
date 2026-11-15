import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { toAuditJson } from '../../common/audit/audit.service';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: {
        permissions: { select: { permission: { select: { id: true, key: true, module: true } } } },
        _count: { select: { users: true } },
      },
    }).then((roles) =>
      roles.map(({ permissions, ...r }) => ({ ...r, permissions: permissions.map((p) => p.permission) })),
    );
  }

  async findOne(id: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { permissions: { select: { permission: true } }, _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    const { permissions, ...rest } = role;
    return { ...rest, permissions: permissions.map((p) => p.permission) };
  }

  async create(dto: CreateRoleDto, actorId: string) {
    await this.assertPermissionsExist(dto.permissionIds);

    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: {
          name: dto.name,
          description: dto.description,
          isSystem: false,
          permissions: { create: dto.permissionIds?.map((permissionId) => ({ permissionId })) ?? [] },
        },
      });
      await tx.auditLog.create({
        data: { userId: actorId, action: 'roles.create', entityType: 'Role', entityId: role.id, after: toAuditJson(role) },
      });
      return role;
    });
  }

  async update(id: string, dto: UpdateRoleDto, actorId: string) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Role not found');
    // Renaming or re-scoping a system role would silently break the guards.
    if (role.isSystem && dto.permissionIds && role.name === 'super_admin') {
      throw new ForbiddenException('super_admin permissions cannot be modified');
    }
    await this.assertPermissionsExist(dto.permissionIds);

    return this.prisma.$transaction(async (tx) => {
      if (dto.permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: dto.permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
          skipDuplicates: true,
        });
      }
      const updated = await tx.role.update({
        where: { id },
        data: { description: dto.description },
      });
      await tx.auditLog.create({
        data: {
          userId: actorId, action: 'roles.update', entityType: 'Role', entityId: id,
          before: toAuditJson(role), after: toAuditJson(updated),
        },
      });
      return updated;
    });
  }

  async remove(id: string, actorId: string) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.isSystem) throw new ForbiddenException('System roles cannot be deleted');
    if (role._count.users > 0) {
      throw new BadRequestException(`${role._count.users} user(s) still hold this role`);
    }

    await this.prisma.$transaction([
      this.prisma.role.delete({ where: { id } }),
      this.prisma.auditLog.create({
        data: { userId: actorId, action: 'roles.delete', entityType: 'Role', entityId: id, before: toAuditJson(role) },
      }),
    ]);
    return { message: 'Role deleted' };
  }

  private async assertPermissionsExist(ids?: string[]) {
    if (!ids?.length) return;
    const found = await this.prisma.permission.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('One or more permission IDs are invalid');
  }
}
