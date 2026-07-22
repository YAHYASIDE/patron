import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PermissionsService } from './permissions.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiBearerAuth()
@ApiTags('permissions')
@Controller('permissions')
export class PermissionsController {
  constructor(private permissions: PermissionsService) {}

  @RequirePermissions('roles.manage')
  @Get()
  findAll() {
    return this.permissions.findAllGrouped();
  }
}
