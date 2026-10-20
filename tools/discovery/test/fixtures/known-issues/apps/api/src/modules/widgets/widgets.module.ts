import { Module } from '@nestjs/common';
import { WidgetsAdminController, WidgetsMixedController } from './widgets.controller';
import { WidgetsService } from './widgets.service';

@Module({ controllers: [WidgetsAdminController, WidgetsMixedController], providers: [WidgetsService] })
export class WidgetsModule {}
