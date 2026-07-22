import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

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

  @ApiOperation({ summary: 'List roles with their permissions and user counts' })
  @Get() findAll() { return this.roles.findAll(); }

  @ApiOperation({ summary: 'Get a role by id' })
  @Get(':id') findOne(@Param('id') id: string) { return this.roles.findOne(id); }

  @ApiOperation({ summary: 'Create a custom role', description: 'Custom (non-system) role with an optional permission set.' })
  @Post() create(@Body() dto: CreateRoleDto, @CurrentUser('id') actorId: string) {
    return this.roles.create(dto, actorId);
  }

  @ApiOperation({ summary: 'Update a role', description: 'Edit description and remap permissions. super_admin permissions are locked.' })
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateRoleDto, @CurrentUser('id') actorId: string) {
    return this.roles.update(id, dto, actorId);
  }

  @ApiOperation({ summary: 'Delete a custom role', description: 'System roles cannot be deleted; roles still held by users cannot either.' })
  @Delete(':id') remove(@Param('id') id: string, @CurrentUser('id') actorId: string) {
    return this.roles.remove(id, actorId);
  }
}
