import { Module } from '@nestjs/common';

import { ReviewsAdminController, ReviewsController, ReviewsPublicController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  controllers: [ReviewsPublicController, ReviewsController, ReviewsAdminController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
