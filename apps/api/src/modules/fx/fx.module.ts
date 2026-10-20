import { Module } from '@nestjs/common';
import { FxController } from './fx.controller';
import { FxService } from './fx.service';

@Module({ controllers: [FxController], providers: [FxService], exports: [FxService] })
export class FxModule {}
