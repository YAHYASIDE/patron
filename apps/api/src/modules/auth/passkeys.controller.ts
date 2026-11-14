import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PasskeysService } from './passkeys.service';
import { PasskeyLoginVerifyDto, PasskeyRegisterVerifyDto } from './dto/auth.dto';

/** Fingerprint / face sign-in (WebAuthn passkeys). */
@ApiTags('auth/passkeys')
@Controller('auth/passkeys')
export class PasskeysController {
  constructor(private passkeys: PasskeysService) {}

  private meta(req: Request, ip: string, deviceInfo?: string) {
    return { ip, userAgent: req.headers['user-agent'], deviceInfo };
  }

  @ApiOperation({ summary: 'Options to add this phone\'s fingerprint/face to my account' })
  @ApiResponse({ status: 200, description: '{ challengeId, options } for navigator.credentials.create.' })
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('register/options')
  registrationOptions(@CurrentUser('id') userId: string) {
    return this.passkeys.registrationOptions(userId);
  }

  @ApiOperation({ summary: 'Save the passkey the phone created' })
  @ApiResponse({ status: 201, description: 'The passkey (no key material).' })
  @ApiResponse({ status: 400, description: 'PASSKEY_INVALID or PASSKEY_CHALLENGE_EXPIRED.' })
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register/verify')
  verifyRegistration(
    @CurrentUser('id') userId: string,
    @Body() dto: PasskeyRegisterVerifyDto,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.passkeys.verifyRegistration(userId, dto, this.meta(req, ip));
  }

  @ApiOperation({ summary: 'Options to sign in with a passkey (discoverable: no name typed)' })
  @ApiResponse({ status: 200, description: '{ challengeId, options } for navigator.credentials.get.' })
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login/options')
  authenticationOptions() {
    return this.passkeys.authenticationOptions();
  }

  @ApiOperation({ summary: 'Sign in with the phone\'s fingerprint/face' })
  @ApiResponse({ status: 200, description: 'Token pair.' })
  @ApiResponse({ status: 401, description: 'PASSKEY_INVALID.' })
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login/verify')
  verifyAuthentication(@Body() dto: PasskeyLoginVerifyDto, @Req() req: Request, @Ip() ip: string) {
    return this.passkeys.verifyAuthentication(dto, this.meta(req, ip, dto.deviceInfo));
  }

  @ApiOperation({ summary: 'My passkeys' })
  @ApiBearerAuth()
  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.passkeys.list(userId);
  }

  @ApiOperation({ summary: 'Remove one of my passkeys' })
  @ApiResponse({ status: 404, description: 'PASSKEY_NOT_FOUND.' })
  @ApiBearerAuth()
  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @Ip() ip: string) {
    return this.passkeys.remove(userId, id, this.meta(req, ip));
  }
}
