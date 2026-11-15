import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { HealthController } from './health.controller';
import { QUEUES } from '../../modules/queues/queue.constants';

@Module({
  imports: [TerminusModule, BullModule.registerQueue({ name: QUEUES.FULFILMENT })],
  controllers: [HealthController],
})
export class HealthModule {}
