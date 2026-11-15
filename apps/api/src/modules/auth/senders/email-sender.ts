import { Logger } from '@nestjs/common';
import { captureOutbox } from './capture-outbox';

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');

export type EmailProviderName = 'resend' | 'capture' | 'disabled';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends account emails (codes). `enabled` false = email codes answer EMAIL_NOT_CONFIGURED. */
export interface EmailSender {
  readonly name: EmailProviderName;
  readonly enabled: boolean;
  send(message: EmailMessage): Promise<void>;
}

export class DisabledEmailSender implements EmailSender {
  readonly name = 'disabled' as const;
  readonly enabled = false;
  send(): Promise<void> {
    return Promise.reject(new Error('Email is not configured'));
  }
}

export class CaptureEmailSender implements EmailSender {
  readonly name = 'capture' as const;
  readonly enabled = true;
  send(m: EmailMessage): Promise<void> {
    captureOutbox.email.push({ to: m.to, subject: m.subject, text: m.text, at: new Date() });
    return Promise.resolve();
  }
}

/**
 * Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * Errors carry the HTTP status only — never the address, the body or the key.
 */
export class ResendEmailSender implements EmailSender {
  readonly name = 'resend' as const;
  readonly enabled = true;
  private readonly log = new Logger('ResendEmail');

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly baseUrl = 'https://api.resend.com',
  ) {}

  async send(m: EmailMessage): Promise<void> {
    const res = await fetch(`${this.baseUrl.replace(/\/+$/, '')}/emails`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text, ...(m.html && { html: m.html }) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      this.log.warn(`Resend refused an email (HTTP ${res.status})`);
      throw new Error(`Resend answered ${res.status}`);
    }
  }
}
