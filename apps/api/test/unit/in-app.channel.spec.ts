import { InAppChannel } from '../../src/modules/notifications/channels/in-app.channel';

describe('InAppChannel', () => {
  let channel: InAppChannel;

  beforeEach(() => {
    channel = new InAppChannel();
  });

  it('exposes the IN_APP code and is always enabled', () => {
    expect(channel.code).toBe('IN_APP');
    expect(channel.isEnabled).toBe(true);
  });

  it('is a no-op that resolves as sent (the service owns the row)', async () => {
    const res = await channel.send();

    expect(res).toEqual({ sent: true });
  });

  it('returns a promise', () => {
    expect(channel.send()).toBeInstanceOf(Promise);
  });
});
