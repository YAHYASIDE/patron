import { Module } from '@nestjs/common';
import { UploadsAdminController, UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';

@Module({
  controllers: [UploadsController, UploadsAdminController],
  providers: [UploadsService],
  exports: [UploadsService],
})
export class UploadsModule {}
