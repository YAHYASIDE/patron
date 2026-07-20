import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

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

  @Get('me')
  me(@CurrentUser('id') userId: string) {
    return this.users.findOne(userId);
  }

  @Patch('me')
  updateMe(@CurrentUser('id') userId: string, @Body() dto: UpdateUserDto) {
    return this.users.updateProfile(userId, dto);
  }

  // ── admin ──

  @RequirePermissions('users.read')
  @Get()
  findAll(@Query() query: QueryUsersDto) {
    return this.users.findAll(query);
  }

  @RequirePermissions('users.read')
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @RequirePermissions('users.write')
  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser('id') actorId: string) {
    return this.users.create(dto, actorId);
  }

  @RequirePermissions('users.write')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: AdminUpdateUserDto, @CurrentUser('id') actorId: string) {
    return this.users.adminUpdate(id, dto, actorId);
  }

  @RequirePermissions('users.block')
  @Patch(':id/block')
  setBlocked(@Param('id') id: string, @Body() dto: BlockUserDto, @CurrentUser('id') actorId: string) {
    return this.users.setBlocked(id, dto, actorId);
  }

  @RequirePermissions('users.write')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.users.remove(id, actorId);
  }
}
