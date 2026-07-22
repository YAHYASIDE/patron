import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';
import { RollupService } from './rollup.service';

@Module({
  providers: [RetentionService, RollupService],
  exports: [RetentionService, RollupService],
})
export class MaintenanceModule {}
