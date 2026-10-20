import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SupportService } from './support.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AdminTicketsQueryDto, CreateTicketDto, UpdateTicketDto } from './dto/support.dto';

@ApiBearerAuth()
@ApiTags('support')
@Controller('support/tickets')
export class SupportController {
  constructor(private support: SupportService) {}

  @ApiOperation({ summary: 'Ask for help, optionally about one of my orders' })
  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateTicketDto) {
    return this.support.create(userId, dto);
  }

  @ApiOperation({ summary: 'My requests and their answers, newest first' })
  @Get()
  mine(@CurrentUser('id') userId: string) {
    return this.support.listMine(userId);
  }
}

@ApiBearerAuth()
@ApiTags('admin/support')
@Controller('admin/support/tickets')
export class SupportAdminController {
  constructor(private support: SupportService) {}

  @RequirePermissions('users.write') @Get()
  list(@Query() query: AdminTicketsQueryDto) {
    return this.support.listAdmin(query.status);
  }

  @RequirePermissions('users.write') @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTicketDto, @CurrentUser('id') actorId: string) {
    return this.support.update(id, dto, actorId);
  }
}
