import { Prisma } from '@prisma/client';
import { AuditService, toAuditJson } from '../../src/common/audit/audit.service';
import { RequestContextStore } from '../../src/common/context/request-context';

describe('toAuditJson', () => {
  it('maps undefined and null to Prisma.JsonNull', () => {
    expect(toAuditJson(undefined)).toBe(Prisma.JsonNull);
    expect(toAuditJson(null)).toBe(Prisma.JsonNull);
  });

  it('redacts sensitive keys at the top level', () => {
    const out = toAuditJson({ id: 'u1', passwordHash: 'secret', twoFaSecret: 'abc' }) as any;
    expect(out).toEqual({ id: 'u1', passwordHash: '[REDACTED]', twoFaSecret: '[REDACTED]' });
  });

  it('redacts *Enc suffixed keys and hash keys case-insensitively', () => {
    const out = toAuditJson({ apiKeyEnc: 'x', tokenHash: 'y', CodeHash: 'z', keep: 1 }) as any;
    expect(out).toEqual({ apiKeyEnc: '[REDACTED]', tokenHash: '[REDACTED]', CodeHash: '[REDACTED]', keep: 1 });
  });

  it('walks nested objects and arrays', () => {
    const out = toAuditJson({
      user: { name: 'Sam', passwordHash: 'nope' },
      devices: [{ token: 't', tokenHash: 'h' }],
    }) as any;
    expect(out).toEqual({
      user: { name: 'Sam', passwordHash: '[REDACTED]' },
      devices: [{ token: 't', tokenHash: '[REDACTED]' }],
    });
  });

  it('reduces a Date to a plain (empty) object because the redaction walk enumerates it', () => {
    // walk() treats a Date as any object and enumerates its own keys (none),
    // so the JSON round-trip yields {} rather than throwing on a non-JSON value.
    const out = toAuditJson({ createdAt: new Date('2026-01-02T03:04:05.000Z') }) as any;
    expect(out.createdAt).toEqual({});
  });

  it('passes primitive values straight through', () => {
    expect(toAuditJson('hello')).toBe('hello');
    expect(toAuditJson(42)).toBe(42);
  });
});

describe('AuditService', () => {
  let prisma: any;
  let service: AuditService;

  const entry = {
    action: 'order.create',
    entityType: 'Order',
    entityId: 'o1',
    before: null,
    after: { id: 'o1', total: 10, passwordHash: 'leak' },
  };

  beforeEach(() => {
    prisma = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
    service = new AuditService(prisma);
  });

  describe('record (transactional)', () => {
    it('writes through the supplied tx client with redacted snapshots', () => {
      const tx: any = { auditLog: { create: jest.fn().mockReturnValue('written') } };

      const res = service.record(tx, entry);

      expect(res).toBe('written');
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      const data = tx.auditLog.create.mock.calls[0][0].data;
      expect(data.action).toBe('order.create');
      expect(data.after).toEqual({ id: 'o1', total: 10, passwordHash: '[REDACTED]' });
      expect(data.before).toBe(Prisma.JsonNull);
    });

    it('prefers the explicit actorId and pulls ip/userId from request context', () => {
      const tx: any = { auditLog: { create: jest.fn().mockReturnValue({}) } };

      void RequestContextStore.run(
        { correlationId: 'c1', userId: 'ctx-user', ip: '9.9.9.9' },
        () => service.record(tx, { ...entry, actorId: 'explicit-actor' }),
      );

      const data = tx.auditLog.create.mock.calls[0][0].data;
      expect(data.userId).toBe('explicit-actor');
      expect(data.ipAddress).toBe('9.9.9.9');
    });

    it('falls back to the context userId when no actorId is given', () => {
      const tx: any = { auditLog: { create: jest.fn().mockReturnValue({}) } };

      void RequestContextStore.run(
        { correlationId: 'c1', userId: 'ctx-user', ip: '1.1.1.1' },
        () => service.record(tx, entry),
      );

      expect(tx.auditLog.create.mock.calls[0][0].data.userId).toBe('ctx-user');
    });

    it('leaves userId and ipAddress undefined outside any request context', () => {
      const tx: any = { auditLog: { create: jest.fn().mockReturnValue({}) } };

      void service.record(tx, entry);

      const data = tx.auditLog.create.mock.calls[0][0].data;
      expect(data.userId).toBeUndefined();
      expect(data.ipAddress).toBeUndefined();
    });
  });

  describe('recordAsync (fire-and-forget)', () => {
    it('writes the audit row on the shared client', async () => {
      await service.recordAsync(entry);

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const data = prisma.auditLog.create.mock.calls[0][0].data;
      expect(data.after.passwordHash).toBe('[REDACTED]');
    });

    it('swallows and logs a write failure instead of throwing', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('db down'));
      const err = jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

      await expect(service.recordAsync(entry)).resolves.toBeUndefined();
      expect(err).toHaveBeenCalledWith(expect.stringContaining('order.create'));
      expect(err).toHaveBeenCalledWith(expect.stringContaining('db down'));
    });
  });
});
