import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiBearerAuth()
@ApiTags('permissions')
@Controller('permissions')
export class PermissionsController {
  constructor(private permissions: PermissionsService) {}

  @ApiOperation({
    summary: 'List the permission catalogue, grouped by module',
    description: 'Read-only. The catalogue is owned by the codebase and installed by the seed.',
  })
  @RequirePermissions('roles.manage')
  @Get()
  findAll() {
    return this.permissions.findAllGrouped();
  }
}
