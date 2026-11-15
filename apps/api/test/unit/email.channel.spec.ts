import { EmailChannel } from '../../src/modules/notifications/channels/email.channel';

const CONFIG: Record<string, any> = {
  'notifications.emailApiKey': 'key-123',
  'notifications.emailEndpoint': 'https://mail.test/send',
  'notifications.emailFrom': 'noreply@patron.test',
};

const outbound = (over: Partial<any> = {}) => ({
  userId: 'u1',
  locale: 'en',
  title: 'Welcome',
  body: 'Hello there',
  email: 'user@example.com',
  ...over,
});

describe('EmailChannel', () => {
  let config: any;
  let channel: EmailChannel;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    config = {
      get: jest.fn((k: string) => CONFIG[k]),
      getOrThrow: jest.fn((k: string) => CONFIG[k]),
    };
    channel = new EmailChannel(config);
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete (global as any).fetch;
    jest.restoreAllMocks();
  });

  it('exposes the EMAIL code', () => {
    expect(channel.code).toBe('EMAIL');
  });

  describe('isEnabled', () => {
    it('is true when an API key is configured', () => {
      expect(channel.isEnabled).toBe(true);
    });

    it('is false when the API key is missing', () => {
      config.get.mockReturnValue(undefined);
      expect(channel.isEnabled).toBe(false);
    });
  });

  describe('send', () => {
    it('fails fast when the recipient has no email address', async () => {
      const res = await channel.send(outbound({ email: undefined }));

      expect(res).toEqual({ sent: false, error: 'No email address on file' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses to send (rather than silently succeed) when the channel is disabled', async () => {
      const warn = jest.spyOn((channel as any).logger, 'warn').mockImplementation(() => undefined);
      config.get.mockImplementation((k: string) => (k === 'notifications.emailApiKey' ? undefined : CONFIG[k]));

      const res = await channel.send(outbound());

      expect(res).toEqual({ sent: false, error: 'Email channel is not configured' });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalled();
    });

    it('posts the message to the provider endpoint and reports success', async () => {
      const res = await channel.send(outbound());

      expect(res).toEqual({ sent: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://mail.test/send');
      expect(init.method).toBe('POST');
      expect(init.headers.authorization).toBe('Bearer key-123');
      expect(JSON.parse(init.body)).toEqual({
        from: 'noreply@patron.test',
        to: 'user@example.com',
        subject: 'Welcome',
        text: 'Hello there',
      });
    });

    it('surfaces a non-2xx provider response as an error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 502 });

      const res = await channel.send(outbound());

      expect(res).toEqual({ sent: false, error: 'Provider returned 502' });
    });

    it('captures a thrown transport error message', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNRESET'));

      const res = await channel.send(outbound());

      expect(res).toEqual({ sent: false, error: 'ECONNRESET' });
    });
  });
});
