import { AuthController } from '../../src/modules/auth/auth.controller';

const req = (userAgent?: string) => ({ headers: { 'user-agent': userAgent } }) as any;

describe('AuthController', () => {
  let auth: any;
  let controller: AuthController;

  beforeEach(() => {
    auth = {
      register: jest.fn().mockResolvedValue('register-result'),
      login: jest.fn().mockResolvedValue('login-result'),
      refresh: jest.fn().mockResolvedValue('refresh-result'),
      logout: jest.fn().mockResolvedValue({ message: 'Logged out' }),
      logoutAll: jest.fn().mockResolvedValue({ message: 'All sessions revoked' }),
      me: jest.fn().mockResolvedValue('me-result'),
      changePassword: jest.fn().mockResolvedValue({ message: 'changed' }),
      verifyEmail: jest.fn().mockResolvedValue({ message: 'verified' }),
      forgotPassword: jest.fn().mockResolvedValue({ message: 'sent' }),
      resetPassword: jest.fn().mockResolvedValue({ message: 'reset' }),
    };
    controller = new AuthController(auth);
  });

  it('register forwards the dto and request metadata (ip + user-agent)', async () => {
    const dto = { email: 'a@b.c', password: 'Str0ngPass!', fullName: 'Amina' } as any;

    const res = await controller.register(dto, req('jest-ua'), '1.2.3.4');

    expect(res).toBe('register-result');
    expect(auth.register).toHaveBeenCalledWith(dto, { ip: '1.2.3.4', userAgent: 'jest-ua', deviceInfo: undefined });
  });

  it('login threads deviceInfo from the dto into the meta object', async () => {
    const dto = { email: 'a@b.c', password: 'Str0ngPass!', deviceInfo: 'iPhone 15' } as any;

    const res = await controller.login(dto, req('safari'), '9.9.9.9');

    expect(res).toBe('login-result');
    expect(auth.login).toHaveBeenCalledWith(dto, { ip: '9.9.9.9', userAgent: 'safari', deviceInfo: 'iPhone 15' });
  });

  it('login leaves deviceInfo undefined when the dto omits it', async () => {
    const dto = { email: 'a@b.c', password: 'Str0ngPass!' } as any;

    await controller.login(dto, req(), '9.9.9.9');

    expect(auth.login).toHaveBeenCalledWith(dto, { ip: '9.9.9.9', userAgent: undefined, deviceInfo: undefined });
  });

  it('refresh passes only the refreshToken plus meta', async () => {
    const dto = { refreshToken: 'raw-refresh' } as any;

    const res = await controller.refresh(dto, req('ua'), '1.1.1.1');

    expect(res).toBe('refresh-result');
    expect(auth.refresh).toHaveBeenCalledWith('raw-refresh', { ip: '1.1.1.1', userAgent: 'ua', deviceInfo: undefined });
  });

  it('logout revokes the presented refresh token', async () => {
    const dto = { refreshToken: 'raw-refresh' } as any;

    const res = await controller.logout(dto, req('ua'), '1.1.1.1');

    expect(res).toEqual({ message: 'Logged out' });
    expect(auth.logout).toHaveBeenCalledWith('raw-refresh', { ip: '1.1.1.1', userAgent: 'ua', deviceInfo: undefined });
  });

  it('logoutAll uses the injected user id and audit metadata', async () => {
    const res = await controller.logoutAll('u1', req('ua'), '2.2.2.2');

    expect(res).toEqual({ message: 'All sessions revoked' });
    expect(auth.logoutAll).toHaveBeenCalledWith('u1', { ip: '2.2.2.2', userAgent: 'ua', deviceInfo: undefined });
  });

  it('me resolves the profile for the authenticated user id', async () => {
    const user = { id: 'u1', email: 'a@b.c', roles: [], permissions: [] };

    const res = await controller.me(user);

    expect(res).toBe('me-result');
    expect(auth.me).toHaveBeenCalledWith('u1');
  });

  it('changePassword forwards the user id and dto', async () => {
    const dto = { currentPassword: 'old', newPassword: 'N3wStr0ngPass!' } as any;

    await controller.changePassword('u1', dto);

    expect(auth.changePassword).toHaveBeenCalledWith('u1', dto);
  });

  it('verifyEmail forwards the user id and code dto', async () => {
    const dto = { code: '123456' } as any;

    await controller.verifyEmail('u1', dto);

    expect(auth.verifyEmail).toHaveBeenCalledWith('u1', dto);
  });

  it('forgotPassword delegates the dto (no request metadata)', async () => {
    const dto = { email: 'a@b.c' } as any;

    await controller.forgotPassword(dto);

    expect(auth.forgotPassword).toHaveBeenCalledWith(dto);
  });

  it('resetPassword delegates the dto (no request metadata)', async () => {
    const dto = { email: 'a@b.c', code: '123456', newPassword: 'N3wStr0ngPass!' } as any;

    await controller.resetPassword(dto);

    expect(auth.resetPassword).toHaveBeenCalledWith(dto);
  });
});
