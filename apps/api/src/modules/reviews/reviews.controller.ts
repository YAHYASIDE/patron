import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ReviewsService } from './reviews.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AdminReviewsQueryDto, CreateReviewDto, PublicReviewsQueryDto, UpdateReviewDto } from './dto/review.dto';

@ApiTags('catalog')
@Public()
@Controller('catalog/reviews')
export class ReviewsPublicController {
  constructor(private reviews: ReviewsService) {}

  @ApiOperation({ summary: 'Published reviews of some products: average, count and the newest 20' })
  @Get()
  list(@Query() query: PublicReviewsQueryDto) {
    return this.reviews.forProducts(query.productIds);
  }
}

@ApiBearerAuth()
@ApiTags('reviews')
@Controller()
export class ReviewsController {
  constructor(private reviews: ReviewsService) {}

  @ApiOperation({ summary: 'Rate a delivered item', description: 'Once per item (409 ALREADY_REVIEWED).' })
  @Post('reviews')
  create(@CurrentUser('id') userId: string, @Body() dto: CreateReviewDto) {
    return this.reviews.create(userId, dto);
  }

  @ApiOperation({ summary: 'Order item ids I already reviewed' })
  @Get('me/reviews')
  mine(@CurrentUser('id') userId: string) {
    return this.reviews.reviewedItemIds(userId);
  }
}

@ApiBearerAuth()
@ApiTags('admin/reviews')
@Controller('admin/reviews')
export class ReviewsAdminController {
  constructor(private reviews: ReviewsService) {}

  @RequirePermissions('catalog.write') @Get()
  list(@Query() query: AdminReviewsQueryDto) {
    return this.reviews.listAdmin(query.published);
  }

  @RequirePermissions('catalog.write') @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReviewDto, @CurrentUser('id') actorId: string) {
    return this.reviews.update(id, dto, actorId);
  }
}
