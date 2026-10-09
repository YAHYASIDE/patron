import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { UsersService } from './users.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminUpdateUserDto, BlockUserDto, CreateUserDto, QueryUsersDto, UpdateUserDto } from './dto/user.dto';

@ApiBearerAuth()
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  // ── self-service, no permission needed beyond being authenticated ──

  @ApiOperation({ summary: 'Get my profile' })
  @Get('me')
  me(@CurrentUser('id') userId: string) {
    return this.users.findOne(userId);
  }

  @ApiOperation({ summary: 'Update my profile', description: 'Self-service; cannot change roles or account status.' })
  @Patch('me')
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateUserDto) {
    return this.users.updateProfile(userId, dto);
  }

  // ── admin ──

  @ApiOperation({ summary: 'List users', description: 'Paginated, filterable by status, role, and search.' })
  @RequirePermissions('users.read')
  @Get()
  findAll(@Query() query: QueryUsersDto) {
    return this.users.findAll(query);
  }

  @ApiOperation({ summary: 'Get a user by id' })
  @RequirePermissions('users.read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @ApiOperation({ summary: 'Create a user', description: 'Assigns the given roles (or customer by default) and opens a default wallet.' })
  @RequirePermissions('users.write')
  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser('id') actorId: string) {
    return this.users.create(dto, actorId);
  }

  @ApiOperation({ summary: 'Update a user (admin)', description: 'Can change scalars, active status, and role assignments.' })
  @RequirePermissions('users.write')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdateUserDto, @CurrentUser('id') actorId: string) {
    return this.users.adminUpdate(id, dto, actorId);
  }

  @ApiOperation({ summary: 'Enable/disable (block) a user', description: 'Blocking also revokes all live sessions. Super admins cannot be blocked.' })
  @RequirePermissions('users.block')
  @Patch(':id/block')
  setBlocked(@Param('id') id: string, @Body() dto: BlockUserDto, @CurrentUser('id') actorId: string) {
    return this.users.setBlocked(id, dto, actorId);
  }

  @ApiOperation({ summary: 'Soft-delete a user', description: 'Blocked when the user has open orders. Revokes all sessions.' })
  @RequirePermissions('users.write')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.users.remove(id, actorId);
  }
}
