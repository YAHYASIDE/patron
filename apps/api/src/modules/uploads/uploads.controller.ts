import { Controller, Get, Param, ParseUUIDPipe, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { IncomingFile, MAX_UPLOAD_BYTES, UploadsService } from './uploads.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

export const imageInterceptor = () => FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

/** Send stored image bytes; the store loads them from another origin. */
export function sendImage(res: Response, row: { mime: string; data: Uint8Array }, cache: string) {
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', cache);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.end(Buffer.from(row.data));
}

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private uploads: UploadsService) {}

  @ApiOperation({ summary: 'A public image (payment-method logo, banner picture)' })
  @Public() @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    // an upload never changes: a new picture gets a new id
    sendImage(res, await this.uploads.getPublic(id), 'public, max-age=31536000, immutable');
  }
}

@ApiBearerAuth()
@ApiTags('admin/uploads')
@Controller('admin/uploads')
export class UploadsAdminController {
  constructor(private uploads: UploadsService) {}

  @ApiOperation({ summary: "Upload a payment method's logo" })
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions('settings.manage') @Post('logo')
  @UseInterceptors(imageInterceptor())
  logo(@UploadedFile() file: IncomingFile, @CurrentUser('id') userId: string) {
    return this.uploads.savePublic('logo', file, userId);
  }

  @ApiOperation({ summary: 'Upload a banner picture' })
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions('banners.manage') @Post('banner')
  @UseInterceptors(imageInterceptor())
  banner(@UploadedFile() file: IncomingFile, @CurrentUser('id') userId: string) {
    return this.uploads.savePublic('banner', file, userId);
  }
}
