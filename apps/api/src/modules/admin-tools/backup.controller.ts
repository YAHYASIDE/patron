import {
  BadRequestException, Body, Controller, Get, HttpCode, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { BackupRunsQueryDto, BackupScheduleDto, ConnectDriveQueryDto, EncryptedBackupDto, VerifyBackupDto } from './backup.dto';
import { BackupRunsService } from './backup-runs.service';
import { GoogleDriveService } from './google-drive.service';

/** A backup file to check: a shop's JSON or .patronbak can be tens of megabytes. */
export const MAX_VERIFY_BYTES = 200 * 1024 * 1024;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The page Google's redirect lands on when there is no dashboard to send the owner back to. */
function callbackPage(ok: boolean, detail: string) {
  const title = ok ? 'تم ربط Google Drive' : 'لم يتم ربط Google Drive';
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;line-height:1.6">
<h1 style="font-size:1.25rem">${title}</h1><p>${escapeHtml(detail)}</p><p>يمكنك إغلاق هذه الصفحة والعودة إلى لوحة التحكم.</p></body></html>`;
}

/**
 * Backups beyond the plain download: encrypted downloads, Google Drive and its
 * schedule, the log of every attempt, and checking a file without restoring
 * it. All `backup.manage` (super_admin passes anyway); the plain download stays
 * on `settings.manage` in DataExportController.
 */
@ApiBearerAuth()
@ApiTags('admin/backup')
@Controller('admin/backup')
export class BackupController {
  constructor(
    private runs: BackupRunsService,
    private drive: GoogleDriveService,
    private audit: AuditService,
  ) {}

  @ApiOperation({ summary: 'Everything the backup section shows: keys, Drive, schedule, last runs' })
  @RequirePermissions('backup.manage') @Get('overview')
  overview() {
    return this.runs.overview();
  }

  @ApiOperation({ summary: 'Backup attempts, newest first' })
  @RequirePermissions('backup.manage') @Get('runs')
  list(@Query() q: BackupRunsQueryDto) {
    return this.runs.runs(q.limit);
  }

  @ApiOperation({
    summary: 'Full backup encrypted with a passphrase (.patronbak)',
    description: 'AES-256-GCM with a key made from the passphrase by scrypt (random salt). The passphrase is never stored or logged; lost, the file cannot be opened.',
  })
  // scrypt takes 128 MiB and about half a second: a few per minute is plenty
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @RequirePermissions('backup.manage') @Post('encrypted') @HttpCode(200)
  async encrypted(@Body() dto: EncryptedBackupDto, @Res({ passthrough: true }) res: Response, @CurrentUser('id') actorId: string) {
    const { filename, body } = await this.runs.encryptedDownload(dto.passphrase, actorId);
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('content-disposition', `attachment; filename="${filename}"`);
    res.setHeader('cache-control', 'no-store');
    return new StreamableFile(body, { length: body.length });
  }

  @ApiOperation({ summary: 'Check a backup file (JSON or .patronbak) the way a restore would, writing nothing' })
  @ApiConsumes('multipart/form-data')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions('backup.manage') @Post('verify') @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_VERIFY_BYTES, files: 1 } }))
  verify(@UploadedFile() file: { buffer: Buffer } | undefined, @Body() dto: VerifyBackupDto) {
    if (!file?.buffer?.length) throw new BadRequestException({ error: 'FILE_REQUIRED', message: 'Choose a backup file to check' });
    return this.runs.verify(file.buffer, dto.passphrase);
  }

  @ApiOperation({ summary: 'Change the scheduled copies to Google Drive' })
  @RequirePermissions('backup.manage') @Put('schedule')
  schedule(@Body() dto: BackupScheduleDto, @CurrentUser('id') actorId: string) {
    return this.runs.setSchedule(dto, actorId);
  }

  // ─── Google Drive ───

  @ApiOperation({ summary: "Google's consent page to connect the owner's Drive (scope drive.file)" })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions('backup.manage') @Get('gdrive/connect')
  async connect(@Query() q: ConnectDriveQueryDto, @CurrentUser('id') actorId: string) {
    return { url: await this.drive.consentUrl(actorId, q.returnTo) };
  }

  @ApiOperation({ summary: "Google's redirect after consent (public: checked by the signed, single-use state)" })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Public() @Get('gdrive/callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ) {
    let returnTo: string | null = null;
    let outcome: { ok: boolean; detail: string; reason?: string };
    try {
      const verified = await this.drive.verifyState(typeof state === 'string' ? state : undefined);
      returnTo = verified.returnTo;
      if (error || typeof code !== 'string' || !code) {
        outcome = {
          ok: false,
          reason: error === 'access_denied' ? 'access_denied' : 'GDRIVE_ERROR',
          detail: error === 'access_denied' ? 'رفضت الإذن في صفحة Google.' : 'لم تُكمل Google الربط.',
        };
      } else {
        const { email } = await this.drive.connect(code, verified.userId);
        await this.audit.recordAsync({ actorId: verified.userId, action: 'backup.drive.connect', entityType: 'SystemSetting', entityId: 'backup.gdrive', after: { email } });
        outcome = { ok: true, detail: email ? `الحساب: ${email}` : 'تم الربط.' };
      }
    } catch (e) {
      const body = e instanceof BadRequestException ? (e.getResponse() as { error?: string }) : {};
      outcome = { ok: false, reason: body.error ?? 'GDRIVE_ERROR', detail: e instanceof Error ? e.message : 'خطأ غير متوقع' };
    }
    res.setHeader('cache-control', 'no-store');
    if (returnTo) {
      const back = new URL(returnTo);
      back.searchParams.set('gdrive', outcome.ok ? 'connected' : 'error');
      if (outcome.reason) back.searchParams.set('reason', outcome.reason);
      back.hash = 'backup';
      return res.redirect(302, back.toString());
    }
    res.status(outcome.ok ? 200 : 400).type('html').send(callbackPage(outcome.ok, outcome.detail));
  }

  @ApiOperation({ summary: 'Forget the Drive connection and revoke it at Google; scheduled copies stop' })
  @RequirePermissions('backup.manage') @Post('gdrive/disconnect') @HttpCode(200)
  async disconnect(@CurrentUser('id') actorId: string) {
    await this.drive.disconnect();
    const schedule = await this.runs.schedule();
    if (schedule.daily || schedule.weekly) await this.runs.setSchedule({ daily: false, weekly: false }, actorId);
    await this.audit.recordAsync({ actorId, action: 'backup.drive.disconnect', entityType: 'SystemSetting', entityId: 'backup.gdrive' });
    return { connected: false };
  }

  @ApiOperation({ summary: 'Send an encrypted copy to Google Drive now' })
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @RequirePermissions('backup.manage') @Post('gdrive/run') @HttpCode(200)
  runNow(@CurrentUser('id') actorId: string) {
    return this.runs.sendToDriveNow(actorId);
  }
}
