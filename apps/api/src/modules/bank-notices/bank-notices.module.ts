import { Module } from '@nestjs/common';

import { BankNoticesController } from './bank-notices.controller';
import { BankNoticesService } from './bank-notices.service';

/** Bank notifications from the Android admin app: evidence for the owner, never approval. */
@Module({
  controllers: [BankNoticesController],
  providers: [BankNoticesService],
})
export class BankNoticesModule {}
