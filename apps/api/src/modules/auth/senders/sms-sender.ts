import { Logger } from '@nestjs/common';
import { VerificationPurpose } from '@prisma/client';
import { captureOutbox } from './capture-outbox';

export const SMS_SENDER = Symbol('SMS_SENDER');

export type SmsProviderName = 'owner_relay' | 'twilio_verify' | 'capture';

/**
 * Delivers phone codes. Three shapes hide behind one interface:
 * - owner_relay: nobody sends anything automatically; the code is kept
 *   encrypted so the owner can read it on «رموز التحقق» and send it by WhatsApp.
 * - twilio_verify: Twilio makes, sends and checks the code itself.
 * - capture: tests read the code from memory.
 */
export interface SmsSender {
  readonly name: SmsProviderName;
  /** Staff read the code to send it by hand (stored encrypted for them). */
  readonly relayedByStaff: boolean;
  /** The provider makes and checks the code; we never see it. */
  readonly providerChecksCode: boolean;
  /** Deliver a code to an E.164 number (`code` is null when the provider makes its own). */
  send(to: string, code: string | null, purpose: VerificationPurpose): Promise<void>;
  /** Ask the provider whether `code` is right (only when providerChecksCode). */
  check(to: string, code: string): Promise<boolean>;
}

export class OwnerRelaySmsSender implements SmsSender {
  readonly name = 'owner_relay' as const;
  readonly relayedByStaff = true;
  readonly providerChecksCode = false;
  send(): Promise<void> {
    // the dashboard lists the code; the owner sends it
    return Promise.resolve();
  }
  check(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export class CaptureSmsSender implements SmsSender {
  readonly name = 'capture' as const;
  readonly relayedByStaff = false;
  readonly providerChecksCode = false;
  send(to: string, code: string | null, purpose: VerificationPurpose): Promise<void> {
    captureOutbox.sms.push({ to, code: code ?? '', purpose, at: new Date() });
    return Promise.resolve();
  }
  check(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

export interface TwilioVerifyOptions {
  accountSid: string;
  authToken: string;
  serviceSid: string;
  channel?: 'sms' | 'whatsapp';
  baseUrl?: string;
}

/**
 * Twilio Verify over its REST API (no SDK: two form posts).
 * https://www.twilio.com/docs/verify/api/verification
 * Errors carry Twilio's status only — never the number, the code or the keys.
 */
export class TwilioVerifySmsSender implements SmsSender {
  readonly name = 'twilio_verify' as const;
  readonly relayedByStaff = false;
  readonly providerChecksCode = true;
  private readonly log = new Logger('TwilioVerify');
  private readonly base: string;

  constructor(private readonly opts: TwilioVerifyOptions) {
    this.base = `${(opts.baseUrl ?? 'https://verify.twilio.com').replace(/\/+$/, '')}/v2/Services/${encodeURIComponent(opts.serviceSid)}`;
  }

  private post(path: string, form: Record<string, string>) {
    const basic = Buffer.from(`${this.opts.accountSid}:${this.opts.authToken}`).toString('base64');
    return fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  }

  async send(to: string): Promise<void> {
    const res = await this.post('/Verifications', { To: to, Channel: this.opts.channel ?? 'sms' });
    if (!res.ok) {
      this.log.warn(`Twilio Verify refused to start a verification (HTTP ${res.status})`);
      throw new Error(`Twilio Verify answered ${res.status}`);
    }
  }

  async check(to: string, code: string): Promise<boolean> {
    const res = await this.post('/VerificationCheck', { To: to, Code: code });
    // 404: no pending verification (expired, already approved or too many tries)
    if (res.status === 404) return false;
    if (!res.ok) {
      this.log.warn(`Twilio Verify check failed (HTTP ${res.status})`);
      throw new Error(`Twilio Verify answered ${res.status}`);
    }
    const body = (await res.json()) as { status?: string; valid?: boolean };
    return body.status === 'approved' || body.valid === true;
  }
}
