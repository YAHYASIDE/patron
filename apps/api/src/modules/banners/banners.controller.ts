import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BannersService } from './banners.service';
import { BannerDto } from './banners.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('catalog')
@Controller('catalog/banners')
export class BannersController {
  constructor(private banners: BannersService) {}

  @ApiOperation({ summary: 'Offers shown on the store home page now' })
  @Public() @Get()
  live() {
    return this.banners.listLive();
  }
}

@ApiBearerAuth()
@ApiTags('admin/banners')
@Controller('admin/banners')
export class BannersAdminController {
  constructor(private banners: BannersService) {}

  @RequirePermissions('banners.manage') @Get()
  list() {
    return this.banners.listAll();
  }

  @RequirePermissions('banners.manage') @Post()
  create(@Body() dto: BannerDto, @CurrentUser('id') actorId: string) {
    return this.banners.create(dto, actorId);
  }

  @RequirePermissions('banners.manage') @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BannerDto, @CurrentUser('id') actorId: string) {
    return this.banners.update(id, dto, actorId);
  }

  @RequirePermissions('banners.manage') @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.banners.remove(id, actorId);
  }
}
