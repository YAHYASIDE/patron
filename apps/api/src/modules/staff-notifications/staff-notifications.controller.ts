import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { StaffInboxService } from './staff-inbox.service';
import { InboxPrefsDto, InboxQueryDto } from './dto/staff-notifications.dto';

/** The owner's notification center; the dashboard bell and the Android admin app read it. */
@ApiBearerAuth()
@ApiTags('admin/staff-notifications')
@RequirePermissions('staff.notifications')
@Controller('admin/staff-notifications')
export class StaffNotificationsController {
  constructor(private inbox: StaffInboxService) {}

  @ApiOperation({ summary: 'Notices for me (muted types left out), with unread and open counts' })
  @Get()
  list(@Query() q: InboxQueryDto, @CurrentUser('id') userId: string) {
    return this.inbox.list(userId, q.state ?? 'open', q.limit);
  }

  @Get('prefs')
  prefs(@CurrentUser('id') userId: string) {
    return this.inbox.prefs(userId);
  }

  @ApiOperation({ summary: 'Replace the notification types I muted' })
  @Put('prefs')
  setPrefs(@Body() dto: InboxPrefsDto, @CurrentUser('id') userId: string) {
    return this.inbox.setPrefs(userId, dto.muted);
  }

  @HttpCode(200) @Post('read-all')
  readAll(@CurrentUser('id') userId: string) {
    return this.inbox.readAll(userId);
  }

  @HttpCode(200) @Post(':id/read')
  read(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.inbox.markRead(id, userId);
  }

  @ApiOperation({ summary: 'Mark a notice dealt with' })
  @HttpCode(200) @Post(':id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') userId: string) {
    return this.inbox.resolve(id, userId);
  }
}
