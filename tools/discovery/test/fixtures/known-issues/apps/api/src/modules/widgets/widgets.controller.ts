// Fixture: admin routes, some deliberately missing a permission decorator.
import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { WidgetsService } from './widgets.service';

@Controller('admin/widgets')
export class WidgetsAdminController {
  constructor(private widgets: WidgetsService) {}

  @RequirePermissions('widgets.read') @Get()
  list() {
    return this.widgets.list();
  }

  // KNOWN ISSUE: no @RequirePermissions — any signed-in customer can delete a widget
  @ApiOperation({ summary: 'Delete a widget', description: 'Returns { ok: true }' })
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ ok: boolean }> {
    return this.widgets.remove(id);
  }

  // KNOWN ISSUE: an empty @RequirePermissions() overrides nothing and checks nothing
  @RequirePermissions() @Post('import')
  import(@Body() body: unknown) {
    return this.widgets.import(body);
  }

  // guarded: any one of the listed permissions is enough
  @RequireAnyPermission('widgets.read', 'widgets.manage') @Get('summary')
  summary() {
    return [];
  }

  // KNOWN ISSUE: an empty @RequireAnyPermission() is no requirement either
  @RequireAnyPermission() @Get('stats')
  stats() {
    return [];
  }

  @Public() @Post('hook')
  hook() {
    return { ok: true };
  }
}

@Controller()
export class WidgetsMixedController {
  @Get('widgets')
  publicList() {
    return [];
  }

  // KNOWN ISSUE: admin path declared on the method
  @Get('admin/widgets-export')
  export() {
    return [];
  }
}
