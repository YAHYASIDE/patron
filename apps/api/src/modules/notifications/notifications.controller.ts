import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';

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

  /** No ids = mark everything read. Answers `{ updated }` (docs/api-contract-50.md). */
  @HttpCode(200) @Post('read')
  async markRead(@CurrentUser('id') userId: string, @Body('ids') ids?: unknown) {
    if (ids === undefined || ids === null) {
      const { count } = await this.notifications.markRead(userId);
      return { updated: count };
    }
    // a malformed id would make Postgres reject the uuid cast; it matches nothing anyway
    const valid = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && isUUID(id)) : [];
    if (!valid.length) return { updated: 0 };
    const { count } = await this.notifications.markRead(userId, valid);
    return { updated: count };
  }
}
