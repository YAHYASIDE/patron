import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { AgentsAdminController, AgentSelfController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentSelfService } from './agent-self.service';
import { CommissionsService } from './commissions.service';
import { AGENTS_QUEUE, CommissionsProcessor } from './commissions.processor';

/**
 * Referral agents (المندوبون): accounts and codes, order attribution, the
 * commission lifecycle driven by order events, payouts and statements.
 * The queue is exported so the outbox relay can hand it order events.
 */
@Module({
  imports: [BullModule.registerQueue({ name: AGENTS_QUEUE })],
  controllers: [AgentsAdminController, AgentSelfController],
  providers: [AgentsService, AgentSelfService, CommissionsService, CommissionsProcessor],
  exports: [BullModule, CommissionsService],
})
export class AgentsModule {}
