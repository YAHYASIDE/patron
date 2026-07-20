import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { RolesService } from './roles.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

@ApiBearerAuth()
@ApiTags('roles')
@RequirePermissions('roles.manage')
@Controller('roles')
export class RolesController {
  constructor(private roles: RolesService) {}

  @Get() findAll() { return this.roles.findAll(); }

  @Get(':id') findOne(@Param('id') id: string) { return this.roles.findOne(id); }

  @Post() create(@Body() dto: CreateRoleDto, @CurrentUser('id') actorId: string) {
    return this.roles.create(dto, actorId);
  }

  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateRoleDto, @CurrentUser('id') actorId: string) {
    return this.roles.update(id, dto, actorId);
  }

  @Delete(':id') remove(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.roles.remove(id, actorId);
  }
}
