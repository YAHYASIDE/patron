import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthController, VerificationsAdminController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { CodesService } from './codes.service';
import { LoginGuardService } from './login-guard.service';
import { PasskeysController } from './passkeys.controller';
import { PasskeysService } from './passkeys.service';
import { RecoveryAdminController, RecoveryController } from './recovery.controller';
import { RecoveryService } from './recovery.service';
import { senderProviders } from './senders/senders.providers';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({})],
  controllers: [AuthController, VerificationsAdminController, PasskeysController, RecoveryController, RecoveryAdminController],
  providers: [
    AuthService, TokenService, CodesService, LoginGuardService, PasskeysService, RecoveryService, JwtStrategy,
    ...senderProviders,
  ],
  exports: [AuthService, TokenService, CodesService],
})
export class AuthModule {}
