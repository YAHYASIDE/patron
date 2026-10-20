/**
 * Where the `capture` providers put what they would have sent. Tests only:
 * the provider factory refuses `capture` in production.
 */
export interface CapturedSms {
  to: string;
  code: string;
  purpose: string;
  at: Date;
}
export interface CapturedEmail {
  to: string;
  subject: string;
  text: string;
  at: Date;
}

export const captureOutbox = {
  sms: [] as CapturedSms[],
  email: [] as CapturedEmail[],
  /** The last code sent to this number or address. */
  lastCode(to: string): string | undefined {
    const sms = [...this.sms].reverse().find((m) => m.to === to);
    const mail = [...this.email].reverse().find((m) => m.to === to);
    const latest = !sms ? mail : !mail ? sms : sms.at >= mail.at ? sms : mail;
    if (!latest) return undefined;
    return 'code' in latest ? latest.code : /\b(\d{6})\b/.exec(latest.text)?.[1];
  },
  clear() {
    this.sms.length = 0;
    this.email.length = 0;
  },
};
