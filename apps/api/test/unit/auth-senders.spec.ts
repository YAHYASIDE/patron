import { randomUUID } from 'crypto';
import nock from 'nock';
import { TwilioVerifySmsSender, OwnerRelaySmsSender, CaptureSmsSender } from '../../src/modules/auth/senders/sms-sender';
import { CaptureEmailSender, DisabledEmailSender, ResendEmailSender } from '../../src/modules/auth/senders/email-sender';
import { emailSenderFrom, smsSenderFrom } from '../../src/modules/auth/senders/senders.providers';
import { captureOutbox } from '../../src/modules/auth/senders/capture-outbox';
import { codeEmail } from '../../src/modules/auth/senders/messages';

// obviously fake credentials, made at runtime
const SID = `AC${randomUUID().replace(/-/g, '')}`;
const SERVICE = `VA${randomUUID().replace(/-/g, '')}`;
const TOKEN = randomUUID();
const KEY = `re_${randomUUID()}`;
const PHONE = '+22222123456';

describe('Twilio Verify (SMS provider)', () => {
  const twilio = () => new TwilioVerifySmsSender({ accountSid: SID, authToken: TOKEN, serviceSid: SERVICE });
  const basic = `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString('base64')}`;

  beforeAll(() => nock.disableNetConnect());
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it('starts a verification with basic auth and a form body', async () => {
    const scope = nock('https://verify.twilio.com', { reqheaders: { authorization: basic } })
      .post(`/v2/Services/${SERVICE}/Verifications`, { To: PHONE, Channel: 'sms' })
      .reply(201, { sid: 'VE1', status: 'pending' });

    await twilio().send(PHONE);
    expect(scope.isDone()).toBe(true);
  });

  it('can deliver over WhatsApp', async () => {
    const scope = nock('https://verify.twilio.com')
      .post(`/v2/Services/${SERVICE}/Verifications`, { To: PHONE, Channel: 'whatsapp' })
      .reply(201, { status: 'pending' });
    await new TwilioVerifySmsSender({ accountSid: SID, authToken: TOKEN, serviceSid: SERVICE, channel: 'whatsapp' }).send(PHONE);
    expect(scope.isDone()).toBe(true);
  });

  it('fails loudly (without secrets in the error) when Twilio refuses', async () => {
    nock('https://verify.twilio.com').post(`/v2/Services/${SERVICE}/Verifications`).reply(401, { code: 20003 });
    const err = await twilio().send(PHONE).catch((e) => e);
    expect(err.message).toBe('Twilio Verify answered 401');
    expect(err.message).not.toContain(TOKEN);
  });

  it('approves a right code', async () => {
    nock('https://verify.twilio.com')
      .post(`/v2/Services/${SERVICE}/VerificationCheck`, { To: PHONE, Code: '123456' })
      .reply(200, { status: 'approved', valid: true });
    expect(await twilio().check(PHONE, '123456')).toBe(true);
  });

  it('refuses a wrong code, and an expired verification (404)', async () => {
    nock('https://verify.twilio.com').post(`/v2/Services/${SERVICE}/VerificationCheck`).reply(200, { status: 'pending', valid: false });
    expect(await twilio().check(PHONE, '000000')).toBe(false);
    nock('https://verify.twilio.com').post(`/v2/Services/${SERVICE}/VerificationCheck`).reply(404, { code: 20404 });
    expect(await twilio().check(PHONE, '000000')).toBe(false);
  });

  it('treats a Twilio outage on check as an error, not a wrong code', async () => {
    nock('https://verify.twilio.com').post(`/v2/Services/${SERVICE}/VerificationCheck`).reply(503);
    await expect(twilio().check(PHONE, '123456')).rejects.toThrow('503');
  });
});

describe('Resend (email provider)', () => {
  beforeAll(() => nock.disableNetConnect());
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it('posts the email with a bearer key', async () => {
    let body: any;
    const scope = nock('https://api.resend.com', { reqheaders: { authorization: `Bearer ${KEY}` } })
      .post('/emails', (b) => {
        body = b;
        return true;
      })
      .reply(200, { id: 'em_1' });

    await new ResendEmailSender(KEY, 'patron <no-reply@example.com>').send({ to: 'a@b.c', subject: 'S', text: 'T', html: '<p>T</p>' });
    expect(scope.isDone()).toBe(true);
    expect(body).toEqual({ from: 'patron <no-reply@example.com>', to: ['a@b.c'], subject: 'S', text: 'T', html: '<p>T</p>' });
  });

  it('throws on a refusal, with the status only', async () => {
    nock('https://api.resend.com').post('/emails').reply(422, { message: 'invalid from' });
    const err = await new ResendEmailSender(KEY, 'x@y.z').send({ to: 'a@b.c', subject: 'S', text: 'T' }).catch((e) => e);
    expect(err.message).toBe('Resend answered 422');
    expect(err.message).not.toContain(KEY);
  });
});

describe('provider selection from env', () => {
  const cfg = (values: Record<string, string | undefined>) => ({
    get: (k: string) => values[k],
    getOrThrow: (k: string) => {
      if (values[k] === undefined) throw new Error(`missing ${k}`);
      return values[k];
    },
  }) as any;

  it('defaults to the owner relay', () => {
    expect(smsSenderFrom(cfg({}))).toBeInstanceOf(OwnerRelaySmsSender);
  });

  it('builds Twilio Verify from its three settings', () => {
    const s = smsSenderFrom(cfg({
      'auth.otpProvider': 'twilio_verify', 'auth.twilio.accountSid': SID, 'auth.twilio.authToken': TOKEN, 'auth.twilio.verifyServiceSid': SERVICE,
    }));
    expect(s).toBeInstanceOf(TwilioVerifySmsSender);
    expect(s.providerChecksCode).toBe(true);
  });

  it('refuses capture providers in production', () => {
    expect(() => smsSenderFrom(cfg({ 'auth.otpProvider': 'capture', 'app.env': 'production' }))).toThrow(/tests only/);
    expect(() => emailSenderFrom(cfg({ 'auth.emailProvider': 'capture', 'app.env': 'production' }))).toThrow(/tests only/);
    expect(smsSenderFrom(cfg({ 'auth.otpProvider': 'capture' }))).toBeInstanceOf(CaptureSmsSender);
  });

  it('turns email on with a Resend key, off without one', () => {
    expect(emailSenderFrom(cfg({}))).toBeInstanceOf(DisabledEmailSender);
    expect(emailSenderFrom(cfg({ 'auth.resendApiKey': KEY, 'auth.emailFrom': 'x@y.z' }))).toBeInstanceOf(ResendEmailSender);
    expect(emailSenderFrom(cfg({ 'auth.emailProvider': 'disabled', 'auth.resendApiKey': KEY }))).toBeInstanceOf(DisabledEmailSender);
    expect(emailSenderFrom(cfg({ 'auth.emailProvider': 'capture' }))).toBeInstanceOf(CaptureEmailSender);
  });

  it('the disabled email sender never pretends to send', async () => {
    const s = new DisabledEmailSender();
    expect(s.enabled).toBe(false);
    await expect(s.send()).rejects.toThrow();
  });

  it('the relay sender sends nothing itself and checks nothing', async () => {
    const s = new OwnerRelaySmsSender();
    await expect(s.send()).resolves.toBeUndefined();
    expect(await s.check()).toBe(false);
    expect(await new CaptureSmsSender().check()).toBe(false);
  });
});

describe('capture outbox and the code email', () => {
  beforeEach(() => captureOutbox.clear());

  it('returns the latest code per destination, SMS or email', async () => {
    await new CaptureSmsSender().send(PHONE, '111111', 'PHONE_LOGIN');
    await new CaptureEmailSender().send({ to: 'a@b.c', ...codeEmail('EMAIL_VERIFY', '222222', 15, 'fr') });
    expect(captureOutbox.lastCode(PHONE)).toBe('111111');
    expect(captureOutbox.lastCode('a@b.c')).toBe('222222');
    expect(captureOutbox.lastCode('nobody')).toBeUndefined();
  });

  it('writes the email in the customer\'s language, Arabic by default', () => {
    expect(codeEmail('PASSWORD_RESET', '123456', 15, 'en').text).toMatch(/choose a new password: 123456/);
    expect(codeEmail('PASSWORD_RESET', '123456', 15, 'fr').subject).toBe('Votre code patron');
    const ar = codeEmail('ACCOUNT_RECOVERY', '123456', 15, null);
    expect(ar.text).toContain('لاستعادة حسابك');
    expect(ar.html).toContain('dir="rtl"');
    expect(codeEmail('TWO_FACTOR', '123456', 15, 'en').text).toContain('to verify your account');
  });
});
