import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';

@ApiBearerAuth()
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get() list(@CurrentUser('id') userId: string, @Query() query: PaginationDto) {
    return this.notifications.listForUser(userId, query);
  }

  @Get('unread-count') unread(@CurrentUser('id') userId: string) {
    return this.notifications.unreadCount(userId).then((count) => ({ count }));
  }

  @HttpCode(200) @Post('read')
  markRead(@CurrentUser('id') userId: string, @Body('ids') ids?: string[]) {
    return this.notifications.markRead(userId, ids);
  }
}
