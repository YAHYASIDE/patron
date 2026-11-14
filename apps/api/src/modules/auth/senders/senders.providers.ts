import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CaptureSmsSender, OwnerRelaySmsSender, SMS_SENDER, SmsSender, TwilioVerifySmsSender,
} from './sms-sender';
import {
  CaptureEmailSender, DisabledEmailSender, EMAIL_SENDER, EmailSender, ResendEmailSender,
} from './email-sender';

const isProduction = (config: ConfigService) => config.get<string>('app.env') === 'production';

/** OTP_PROVIDER picks the phone-code provider; owner_relay is today's behaviour and the default. */
export function smsSenderFrom(config: ConfigService): SmsSender {
  const name = config.get<string>('auth.otpProvider') ?? 'owner_relay';
  if (name === 'capture') {
    if (isProduction(config)) throw new Error('OTP_PROVIDER=capture is for tests only');
    return new CaptureSmsSender();
  }
  if (name === 'twilio_verify') {
    const channel = config.get<string>('auth.twilio.channel') === 'whatsapp' ? 'whatsapp' : 'sms';
    return new TwilioVerifySmsSender({
      accountSid: config.getOrThrow<string>('auth.twilio.accountSid'),
      authToken: config.getOrThrow<string>('auth.twilio.authToken'),
      serviceSid: config.getOrThrow<string>('auth.twilio.verifyServiceSid'),
      channel,
    });
  }
  return new OwnerRelaySmsSender();
}

/** EMAIL_PROVIDER, or Resend whenever RESEND_API_KEY is set; otherwise email codes are off. */
export function emailSenderFrom(config: ConfigService): EmailSender {
  const key = config.get<string>('auth.resendApiKey');
  const name = config.get<string>('auth.emailProvider') ?? (key ? 'resend' : 'disabled');
  if (name === 'capture') {
    if (isProduction(config)) throw new Error('EMAIL_PROVIDER=capture is for tests only');
    return new CaptureEmailSender();
  }
  if (name === 'resend' && key) {
    return new ResendEmailSender(key, config.getOrThrow<string>('auth.emailFrom'));
  }
  return new DisabledEmailSender();
}

export const senderProviders: Provider[] = [
  { provide: SMS_SENDER, useFactory: smsSenderFrom, inject: [ConfigService] },
  { provide: EMAIL_SENDER, useFactory: emailSenderFrom, inject: [ConfigService] },
];
