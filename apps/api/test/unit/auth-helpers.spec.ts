import { describeDevice } from '../../src/modules/auth/device';
import { accountWhere, maskContact, parseIdentifier } from '../../src/modules/auth/identifier';
import { PasskeysController } from '../../src/modules/auth/passkeys.controller';
import { RecoveryAdminController, RecoveryController } from '../../src/modules/auth/recovery.controller';

describe('describeDevice', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1', 'iPhone · Safari'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36', 'Android · Chrome'],
    ['Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 SamsungBrowser/24.0 Chrome/117.0 Safari/537.36', 'Android tablet · Samsung Internet'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0', 'Windows · Edge'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5; rv:127.0) Gecko/20100101 Firefox/127.0', 'Mac · Firefox'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) CriOS/126.0 Mobile Safari/604.1', 'iPad · Chrome'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/126.0 Safari/537.36 OPR/110.0', 'Chromebook · Opera'],
    ['Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/127.0', 'Linux · Firefox'],
    ['Dart/3.4 (dart:io)', 'App'],
  ])('%s → %s', (ua, label) => expect(describeDevice(ua)).toBe(label));

  it('says nothing rather than guessing', () => {
    expect(describeDevice(undefined)).toBeUndefined();
    expect(describeDevice('curl/8.0')).toBeUndefined();
  });
});

describe('parseIdentifier', () => {
  it('normalises an email and a number', () => {
    expect(parseIdentifier('  Sidi@Mail.MR ')).toEqual({ kind: 'email', to: 'sidi@mail.mr' });
    expect(parseIdentifier('00222 22-12-34-56')).toEqual({ kind: 'phone', to: '+22222123456' });
    expect(parseIdentifier('(+222) 22.12.34.56')).toEqual({ kind: 'phone', to: '+22222123456' });
  });

  it.each(['', 'sidi', '22123456', 'a@b', '+0123456789'])('refuses %p', (raw) => {
    expect(() => parseIdentifier(raw)).toThrow(/international format/);
  });

  it('builds the account lookup and masks for display', () => {
    expect(accountWhere({ kind: 'email', to: 'a@b.c' })).toEqual({ email: 'a@b.c', deletedAt: null });
    expect(accountWhere({ kind: 'phone', to: '+22222123456' })).toEqual({ phone: '+22222123456', deletedAt: null });
    expect(maskContact({ kind: 'phone', to: '+22222123456' })).toBe('+222****3456');
    expect(maskContact({ kind: 'phone', to: '+2221' })).toBe('****');
    expect(maskContact({ kind: 'email', to: 'sidi@mail.mr' })).toBe('s***@mail.mr');
  });
});

describe('passkey and recovery controllers', () => {
  const req = { headers: { 'user-agent': 'ua' } } as any;
  const META = { ip: '9.9.9.9', userAgent: 'ua' };

  it('forward to the passkey service with the request metadata', async () => {
    const svc: any = {
      registrationOptions: jest.fn(), verifyRegistration: jest.fn(), authenticationOptions: jest.fn(),
      verifyAuthentication: jest.fn(), list: jest.fn(), remove: jest.fn(),
    };
    const c = new PasskeysController(svc);
    const dto = { challengeId: 'c', response: {} };
    await c.registrationOptions('u1');
    await c.verifyRegistration('u1', dto, req, '9.9.9.9');
    await c.authenticationOptions();
    await c.verifyAuthentication({ ...dto, deviceInfo: 'Pixel' }, req, '9.9.9.9');
    await c.list('u1');
    await c.remove('u1', 'pk', req, '9.9.9.9');
    expect(svc.registrationOptions).toHaveBeenCalledWith('u1');
    expect(svc.verifyRegistration).toHaveBeenCalledWith('u1', dto, { ...META, deviceInfo: undefined });
    expect(svc.verifyAuthentication).toHaveBeenCalledWith({ ...dto, deviceInfo: 'Pixel' }, { ...META, deviceInfo: 'Pixel' });
    expect(svc.remove).toHaveBeenCalledWith('u1', 'pk', { ...META, deviceInfo: undefined });
  });

  it('forward to the recovery service; staff actions carry the actor', async () => {
    const svc: any = { request: jest.fn(), complete: jest.fn(), list: jest.fn(), verify: jest.fn(), reject: jest.fn() };
    const pub = new RecoveryController(svc);
    const admin = new RecoveryAdminController(svc);
    await pub.request({ contact: 'a@b.c', fullName: 'A', proof: 'p'.repeat(10) }, req, '9.9.9.9');
    await pub.complete({ contact: 'a@b.c', code: '123456', newPassword: 'N3wStrongPass' }, req, '9.9.9.9');
    await admin.list({ status: 'PENDING' });
    await admin.verify('rq', { note: 'ok' }, 'staff', req, '9.9.9.9');
    await admin.reject('rq', {}, 'staff', req, '9.9.9.9');
    expect(svc.request).toHaveBeenCalledWith(expect.objectContaining({ contact: 'a@b.c' }), META);
    expect(svc.list).toHaveBeenCalledWith('PENDING');
    expect(svc.verify).toHaveBeenCalledWith('rq', 'staff', 'ok', META);
    expect(svc.reject).toHaveBeenCalledWith('rq', 'staff', undefined, META);
  });
});
