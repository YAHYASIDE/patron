import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { EventsController, FeedbackAdminController } from './feedback.controller';
import { FeedbackService } from './feedback.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [EventsController, FeedbackAdminController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
