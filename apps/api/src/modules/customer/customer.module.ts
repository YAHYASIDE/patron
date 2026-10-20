import { Module } from '@nestjs/common';

import { MeController, StoreFactsController } from './customer.controller';
import { CustomerService } from './customer.service';
import { WatchesService } from './watches.service';
import { StoreFactsService } from './store-facts.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [MeController, StoreFactsController],
  providers: [CustomerService, WatchesService, StoreFactsService],
  // the hourly alert sweep runs from the queue workers
  exports: [WatchesService],
})
export class CustomerModule {}
