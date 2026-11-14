// Fixture: every admin route is guarded, in each of the ways the API allows.
// A commented-out route must not count: @Get('admin/ghost')
import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { GadgetsService } from './gadgets.service';

/** Class-level permission covers every method. */
@RequirePermissions('gadgets.manage')
@Controller('admin/gadgets')
export class GadgetsAdminController {
  constructor(private gadgets: GadgetsService) {}

  @ApiOperation({
    summary: 'List gadgets',
    description: 'Text that looks like code: @Get("admin/fake") { } ( }',
  })
  @Get()
  async get(): Promise<{ items: string[] }> {
    const re = /[{(]/g; // a regex with brackets must not confuse the reader
    return { items: ['a'.replace(re, '')] };
  }

  @HttpCode(200) @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.gadgets.archive(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { name: string }) {
    return { id, ...body };
  }
}

@Controller({ path: 'admin/gadget-reports' })
export class GadgetReportsController {
  @RequirePermissions('reports.read')
  @Get('daily')
  daily() {
    return [];
  }

  @Public()
  @Post('webhook')
  webhook() {
    return { ok: true };
  }
}

@Controller('gadgets')
export class GadgetsPublicController {
  @Public() @Get()
  list() {
    return [];
  }
}
