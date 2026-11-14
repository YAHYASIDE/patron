import { Body, Controller, Delete, Get, HttpCode, Ip, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';

import { AuthService } from './auth.service';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  ChangePasswordDto, ForgotPasswordDto, LoginDto, PhoneLoginDto, PhoneStartDto, RefreshDto,
  RegisterDto, RequestPhoneCodeDto, ResetPasswordDto, SetPasswordDto, VerifyCodeDto,
} from './dto/auth.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  private meta(req: Request, ip: string, deviceInfo?: string) {
    return { ip, userAgent: req.headers['user-agent'], deviceInfo };
  }

  @ApiOperation({
    summary: 'Register a new customer account',
    description:
      'Creates the user, assigns the customer role, opens a default wallet, and ' +
      'returns a token pair. Also issues an email-verification code.',
  })
  @ApiResponse({ status: 201, description: 'Account created; token pair returned.' })
  @ApiResponse({ status: 400, description: 'Email/phone already in use, or validation failure.' })
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.register(dto, this.meta(req, ip, dto.deviceInfo));
  }

  @ApiOperation({
    summary: 'Log in with an email or a phone number and a password',
    description:
      '`identifier` is an email or an E.164 number (`email` still works). Argon2id-verified. ' +
      'Failures count per (identifier, IP) and per IP, never against the account everywhere.',
  })
  @ApiResponse({ status: 200, description: 'Authenticated; token pair returned.' })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS.' })
  @ApiResponse({ status: 403, description: 'Account blocked/inactive, or TOO_MANY_ATTEMPTS (with retryAfter).' })
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.login(dto, this.meta(req, ip, dto.deviceInfo));
  }

  @ApiOperation({
    summary: 'Sign in with a WhatsApp number',
    description:
      'A new number (with a full name) signs straight in, unverified. A number that is ' +
      'verified, has a password or has orders returns CODE_REQUIRED: the owner relays a ' +
      'code over WhatsApp, then POST /auth/phone/login.',
  })
  @ApiResponse({ status: 200, description: '{ status: SIGNED_IN, ...tokens } or { status: CODE_REQUIRED }.' })
  @ApiResponse({ status: 400, description: 'NAME_REQUIRED for a new number, or validation failure.' })
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('phone/start')
  phoneStart(@Body() dto: PhoneStartDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.phoneStart(dto, this.meta(req, ip, dto.deviceInfo));
  }

  @ApiOperation({ summary: 'Finish a WhatsApp sign-in with the relayed code' })
  @ApiResponse({ status: 200, description: 'Token pair; the number is now verified.' })
  @ApiResponse({ status: 400, description: 'Invalid or expired code.' })
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('phone/login')
  phoneLogin(@Body() dto: PhoneLoginDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.phoneLogin(dto, this.meta(req, ip, dto.deviceInfo));
  }

  @ApiOperation({
    summary: 'Ask for a code to verify the WhatsApp number',
    description: 'The code goes to the owner, who sends it over WhatsApp. Asking again reuses the live code.',
  })
  @ApiResponse({ status: 200, description: '{ status: SENT | VERIFIED, phone }.' })
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @HttpCode(200)
  @Post('phone/request-code')
  requestPhoneCode(@CurrentUser('id') userId: string, @Body() dto: RequestPhoneCodeDto) {
    return this.auth.requestPhoneCode(userId, dto);
  }

  @ApiOperation({ summary: 'Verify the WhatsApp number with the relayed code' })
  @ApiResponse({ status: 200, description: 'Number verified.' })
  @ApiResponse({ status: 400, description: 'Invalid or expired code.' })
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('phone/verify')
  verifyPhone(@CurrentUser('id') userId: string, @Body() dto: VerifyCodeDto) {
    return this.auth.verifyPhone(userId, dto);
  }

  @ApiOperation({
    summary: 'Rotate a refresh token',
    description:
      'Issues a new token pair and revokes the presented refresh token. Reusing ' +
      'an already-rotated token revokes the whole session family.',
  })
  @ApiResponse({ status: 200, description: 'New token pair issued.' })
  @ApiResponse({ status: 401, description: 'Invalid, expired, or reused refresh token.' })
  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.refresh(dto.refreshToken, this.meta(req, ip));
  }

  @ApiOperation({ summary: 'Log out the current session', description: 'Revokes the presented refresh token. Idempotent.' })
  @ApiResponse({ status: 200, description: 'Session revoked.' })
  @Public()
  @HttpCode(200)
  @Post('logout')
  logout(@Body() dto: RefreshDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.logout(dto.refreshToken, this.meta(req, ip));
  }

  @ApiOperation({ summary: 'Log out of every session', description: 'Revokes all refresh tokens for the authenticated user.' })
  @ApiResponse({ status: 200, description: 'All sessions revoked.' })
  @ApiBearerAuth()
  @HttpCode(200)
  @Post('logout-all')
  logoutAll(@CurrentUser('id') userId: string, @Req() req: Request, @Ip() ip: string) {
    return this.auth.logoutAll(userId, this.meta(req, ip));
  }

  @ApiOperation({ summary: 'Get the authenticated user profile' })
  @ApiResponse({ status: 200, description: 'Profile with roles and wallet balances.' })
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @ApiOperation({
    summary: 'Change the current password',
    description: 'Requires the current password. Revokes every existing session on success.',
  })
  @ApiResponse({ status: 200, description: 'Password changed; all sessions revoked.' })
  @ApiResponse({ status: 401, description: 'Current password is incorrect.' })
  @ApiBearerAuth()
  @HttpCode(200)
  @Post('change-password')
  changePassword(@CurrentUser('id') userId: string, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(userId, dto);
  }

  @ApiOperation({ summary: 'Verify the account email with a code' })
  @ApiResponse({ status: 200, description: 'Email verified.' })
  @ApiResponse({ status: 400, description: 'Invalid or expired code.' })
  @ApiBearerAuth()
  @HttpCode(200)
  @Post('verify-email')
  verifyEmail(@CurrentUser('id') userId: string, @Body() dto: VerifyCodeDto) {
    return this.auth.verifyEmail(userId, dto);
  }

  @ApiOperation({
    summary: 'Send the email-verification code again',
    description: 'One per cooldown (429 RESEND_COOLDOWN with retryAfter). EMAIL_NOT_CONFIGURED when email is off.',
  })
  @ApiResponse({ status: 200, description: '{ status: SENT | VERIFIED }.' })
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @HttpCode(200)
  @Post('verify-email/resend')
  resendEmailCode(@CurrentUser('id') userId: string) {
    return this.auth.resendEmailCode(userId);
  }

  @ApiOperation({
    summary: 'Add a first password (WhatsApp-number accounts)',
    description: 'Only once the number (or email) is verified; then POST /auth/login accepts the number + password.',
  })
  @ApiResponse({ status: 200, description: 'Password set.' })
  @ApiResponse({ status: 400, description: 'PASSWORD_ALREADY_SET.' })
  @ApiResponse({ status: 403, description: 'VERIFY_FIRST.' })
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 600_000 } })
  @HttpCode(200)
  @Post('password')
  setPassword(@CurrentUser('id') userId: string, @Body() dto: SetPasswordDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.setPassword(userId, dto, this.meta(req, ip));
  }

  // ─────────────── Sessions & devices ───────────────

  @ApiOperation({ summary: 'My signed-in devices', description: 'The device asking is marked `current`.' })
  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id, user.sessionId);
  }

  @ApiOperation({ summary: 'Sign out every device except this one' })
  @ApiBearerAuth()
  @HttpCode(200)
  @Post('sessions/revoke-others')
  revokeOtherSessions(@CurrentUser() user: AuthUser, @Req() req: Request, @Ip() ip: string) {
    return this.auth.revokeOtherSessions(user.id, user.sessionId, this.meta(req, ip));
  }

  @ApiOperation({ summary: 'Sign out one device', description: 'Its refresh token stops working and its access token is refused at once.' })
  @ApiResponse({ status: 404, description: 'SESSION_NOT_FOUND.' })
  @ApiBearerAuth()
  @Delete('sessions/:id')
  revokeSession(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Ip() ip: string,
  ) {
    return this.auth.revokeSession(userId, id, this.meta(req, ip));
  }

  @ApiOperation({
    summary: 'Request a password-reset code by email or by phone',
    description:
      '`identifier` is an email or an E.164 number. Always the same response whether or not an ' +
      'account exists. EMAIL_NOT_CONFIGURED (by email) depends on server settings only.',
  })
  @ApiResponse({ status: 200, description: 'Reset code sent if the account exists.' })
  @Public()
  @Throttle({ default: { limit: 3, ttl: 300_000 } })
  @HttpCode(200)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  @ApiOperation({
    summary: 'Reset the password with a code',
    description: 'Only after proving the code sent to that email or number; revokes every existing session.',
  })
  @ApiResponse({ status: 200, description: 'Password reset; all sessions revoked.' })
  @ApiResponse({ status: 400, description: 'INVALID_CODE or CODE_ATTEMPTS_EXCEEDED.' })
  @Public()
  @Throttle({ default: { limit: 5, ttl: 300_000 } })
  @HttpCode(200)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.resetPassword(dto, this.meta(req, ip));
  }
}

/**
 * The owner's queue of codes to send by hand over WhatsApp. Reading a code lets
 * one sign in as that customer, so it takes the user-management permission.
 */
@ApiBearerAuth()
@ApiTags('admin/verifications')
@Controller('admin/verifications')
export class VerificationsAdminController {
  constructor(private auth: AuthService) {}

  @ApiOperation({ summary: 'Codes waiting to be sent, with the customer and the code' })
  @RequirePermissions('users.write')
  @Get('pending')
  pending() {
    return this.auth.listRelayPending();
  }

  @ApiOperation({ summary: 'Record that the owner sent this code' })
  @RequirePermissions('users.write')
  @HttpCode(200)
  @Post(':id/sent')
  sent(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('id') actorId: string) {
    return this.auth.markRelaySent(id, actorId);
  }
}
