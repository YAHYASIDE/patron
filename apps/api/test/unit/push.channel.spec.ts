import { PushChannel } from '../../src/modules/notifications/channels/push.channel';

const CONFIG: Record<string, any> = {
  'notifications.fcmServerKey': 'fcm-secret',
};

const outbound = (over: Partial<any> = {}) => ({
  userId: 'u1',
  locale: 'en',
  title: 'Ping',
  body: 'Your order moved',
  deviceTokens: ['tok-a', 'tok-b'],
  data: { orderId: 'o1' },
  ...over,
});

describe('PushChannel', () => {
  let config: any;
  let channel: PushChannel;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    config = { get: jest.fn((k: string) => CONFIG[k]) };
    channel = new PushChannel(config);
    fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    (global as any).fetch = fetchMock;
  });

  afterEach(() => {
    delete (global as any).fetch;
  });

  it('exposes the PUSH code', () => {
    expect(channel.code).toBe('PUSH');
  });

  describe('isEnabled', () => {
    it('is true when the FCM server key is configured', () => {
      expect(channel.isEnabled).toBe(true);
    });

    it('is false when the FCM server key is missing', () => {
      config.get.mockReturnValue(undefined);
      expect(channel.isEnabled).toBe(false);
    });
  });

  describe('send', () => {
    it('fails when the user has no registered devices', async () => {
      const res = await channel.send(outbound({ deviceTokens: [] }));

      expect(res).toEqual({ sent: false, error: 'No registered devices' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails when deviceTokens is entirely absent', async () => {
      const res = await channel.send(outbound({ deviceTokens: undefined }));

      expect(res).toEqual({ sent: false, error: 'No registered devices' });
    });

    it('fails when the channel is not configured', async () => {
      config.get.mockReturnValue(undefined);

      const res = await channel.send(outbound());

      expect(res).toEqual({ sent: false, error: 'Push channel is not configured' });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('posts a multicast payload to FCM and reports success', async () => {
      const res = await channel.send(outbound());

      expect(res).toEqual({ sent: true });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://fcm.googleapis.com/fcm/send');
      expect(init.headers.authorization).toBe('key=fcm-secret');
      expect(JSON.parse(init.body)).toEqual({
        registration_ids: ['tok-a', 'tok-b'],
        notification: { title: 'Ping', body: 'Your order moved' },
        data: { orderId: 'o1' },
      });
    });

    it('defaults the data payload to an empty object', async () => {
      await channel.send(outbound({ data: undefined }));

      expect(JSON.parse(fetchMock.mock.calls[0][1].body).data).toEqual({});
    });

    it('surfaces a non-2xx FCM response as an error', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 401 });

      const res = await channel.send(outbound());

      expect(res).toEqual({ sent: false, error: 'FCM returned 401' });
    });

    it('captures a thrown transport error message', async () => {
      fetchMock.mockRejectedValue(new Error('socket hang up'));

      const res = await channel.send(outbound());

      expect(res).toEqual({ sent: false, error: 'socket hang up' });
    });
  });
});
