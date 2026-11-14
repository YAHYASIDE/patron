// Fixture: regex literals with brackets and quotes inside method bodies, then more routes.
// The unguarded route at the end must still be found.
import { Controller, Get, Post } from '@nestjs/common';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@Controller('admin/sanitize')
export class SanitizeAdminController {
  @RequirePermissions('sanitize.read')
  @Get('strip')
  strip() {
    const re = /[{(]/g;
    const quotes = /["'`}]+/;
    return 'a{b'.replace(re, '').replace(quotes, '');
  }

  @RequirePermissions('sanitize.read')
  @Post('ratio')
  ratio() {
    const half = 10 / 2 / 1;
    return { half, slash: /\/[}{]/.source };
  }

  @Get('leak')
  leak() {
    return { open: true };
  }
}
