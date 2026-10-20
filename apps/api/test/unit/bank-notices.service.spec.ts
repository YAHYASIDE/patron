import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import {
  ALLOWED_APPS_KEY, BankNoticesService, noticeFingerprint,
} from '../../src/modules/bank-notices/bank-notices.service';
import { BankNoticesController } from '../../src/modules/bank-notices/bank-notices.controller';
import { BankConfigDto, IngestBankNoticeDto } from '../../src/modules/bank-notices/dto/bank-notices.dto';

const APP = 'mr.bankily.app';
const ID = '11111111-1111-4111-8111-111111111111';
const PAY = '22222222-2222-4222-8222-222222222222';

const dto = (over: Partial<IngestBankNoticeDto> = {}): IngestBankNoticeDto => ({
  deviceId: 'dev-1', sourceApp: APP, title: 'Bankily',
  text: 'تم استلام 1500 أوقية من 22334455. رقم العملية: 88213451', postedAt: '2026-10-20T10:00:00.000Z', ...over,
});

const stored = (over: Record<string, unknown> = {}) => ({
  id: ID, deviceId: 'dev-1', sourceApp: APP, title: 'Bankily', text: 't', postedAt: new Date(), receivedAt: new Date(),
  amount: new Prisma.Decimal('1500'), currency: 'MRU', reference: '88213451', sender: '22334455', confidence: 100,
  parser: 'generic-v1:ar', status: 'NEW', fingerprint: 'f', duplicateOfId: null, suggestedPaymentId: null,
  matchedPaymentId: null, reviewedById: null, reviewedAt: null, reviewNote: null, ...over,
});

describe('BankNoticesService', () => {
  let prisma: any;
  let tx: any;
  let audit: any;
  let staff: any;
  let service: BankNoticesService;

  beforeEach(() => {
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      payment: { findUnique: jest.fn().mockResolvedValue({ id: PAY, gateway: 'MANUAL' }) },
      bankNotification: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      systemSetting: { upsert: jest.fn().mockResolvedValue({}) },
    };
    prisma = {
      systemSetting: { findUnique: jest.fn().mockResolvedValue({ key: ALLOWED_APPS_KEY, value: [APP] }) },
      bankNotification: {
        findUnique: jest.fn().mockResolvedValue(null),
        findUniqueOrThrow: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn((a: any) => Promise.resolve(stored({ ...a.data, amount: a.data.amount ? new Prisma.Decimal(a.data.amount) : null }))),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ orderId: 'o1', order: { orderNumber: 'PTN-7' } }),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined), recordAsync: jest.fn().mockResolvedValue(undefined) };
    staff = { notify: jest.fn().mockResolvedValue({}), resolve: jest.fn().mockResolvedValue(undefined) };
    service = new BankNoticesService(prisma, audit, staff);
  });

  describe('config', () => {
    it('allows no app until the owner picks them', async () => {
      prisma.systemSetting.findUnique.mockResolvedValueOnce(null);
      await expect(service.config()).resolves.toEqual({ allowedApps: [] });
      prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: 'not-a-list' });
      await expect(service.allowedApps()).resolves.toEqual([]);
      prisma.systemSetting.findUnique.mockResolvedValueOnce({ value: [APP, 3, null] });
      await expect(service.allowedApps()).resolves.toEqual([APP]);
    });

    it('saves the list deduplicated and sorted, audited', async () => {
      await expect(service.setConfig(['mr.masrvi', APP, 'mr.masrvi'], 'admin')).resolves.toEqual({ allowedApps: [APP, 'mr.masrvi'] });
      expect(tx.systemSetting.upsert.mock.calls[0][0]).toMatchObject({
        where: { key: ALLOWED_APPS_KEY }, update: { value: [APP, 'mr.masrvi'] }, create: { isPublic: false, group: 'payments' },
      });
      expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'bank_notices.config' }));
    });
  });

  describe('ingest', () => {
    it('refuses an app that is not allowed (none are by default)', async () => {
      prisma.systemSetting.findUnique.mockResolvedValueOnce(null);
      await expect(service.ingest(dto(), 'admin')).rejects.toMatchObject({ response: expect.objectContaining({ error: 'BANK_APP_NOT_ALLOWED' }) });
      await expect(service.ingest(dto({ sourceApp: 'com.whatsapp' }), 'admin')).rejects.toMatchObject({
        response: expect.objectContaining({ error: 'BANK_APP_NOT_ALLOWED' }),
      });
      expect(prisma.bankNotification.create).not.toHaveBeenCalled();
    });

    it('stores the sanitized text, the parsed fields, and raises bank.unmatched when nothing waits', async () => {
      const res = await service.ingest(dto({ text: 'رمز التحقق 482913. تم استلام 1500 أوقية من 22334455. رقم العملية: 88213451' }), 'admin');
      const data = prisma.bankNotification.create.mock.calls[0][0].data;
      expect(data.text).not.toContain('482913');
      expect(data).toMatchObject({
        amount: '1500', currency: 'MRU', reference: '88213451', sender: '22334455', status: 'NEW', parser: 'generic-v1:ar',
        fingerprint: noticeFingerprint('dev-1', APP, data.text, new Date('2026-10-20T10:00:00.000Z')),
      });
      expect(data.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(res).toEqual({ id: ID, status: 'NEW', duplicate: false, amount: '1500', currency: 'MRU', reference: '88213451', confidence: 100 });
      expect(staff.notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'bank.unmatched', dedupeKey: `bank.unmatched:${ID}`, link: '/bank-notices' }));
      expect(audit.recordAsync).toHaveBeenCalledWith(expect.objectContaining({ action: 'bank_notices.ingest' }));
    });

    it('a notification sent again returns the stored one with duplicate=true', async () => {
      prisma.bankNotification.findUnique.mockResolvedValueOnce(stored({ status: 'SUGGESTED' }));
      await expect(service.ingest(dto(), 'admin')).resolves.toMatchObject({ id: ID, status: 'SUGGESTED', duplicate: true });
      expect(prisma.bankNotification.create).not.toHaveBeenCalled();
      expect(staff.notify).not.toHaveBeenCalled();
    });

    it('the same notification racing itself: the unique fingerprint answers the loser with the winner', async () => {
      prisma.bankNotification.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
      prisma.bankNotification.findUniqueOrThrow.mockResolvedValueOnce(stored());
      await expect(service.ingest(dto(), 'admin')).resolves.toMatchObject({ id: ID, duplicate: true });

      prisma.bankNotification.create.mockRejectedValueOnce(new Error('db down'));
      await expect(service.ingest(dto(), 'admin')).rejects.toThrow('db down');
    });

    it('a reference already seen is a DUPLICATE of the first notice, kept and never matched', async () => {
      prisma.bankNotification.findFirst.mockResolvedValueOnce({ id: 'first' });
      const res = await service.ingest(dto(), 'admin');
      expect(prisma.bankNotification.create.mock.calls[0][0].data).toMatchObject({ status: 'DUPLICATE', duplicateOfId: 'first', suggestedPaymentId: null });
      expect(res.status).toBe('DUPLICATE');
      expect(prisma.payment.findMany).not.toHaveBeenCalled();
      expect(staff.notify).not.toHaveBeenCalled();
    });

    it('suggests the waiting manual payment of the same amount and raises bank.match', async () => {
      prisma.payment.findMany.mockResolvedValueOnce([
        { id: PAY, amount: new Prisma.Decimal('1500'), currency: 'MRU', status: 'AUTHORIZED', createdAt: new Date(), rawResponse: { transfer: { reference: '88213451', payerPhone: '22334455' } } },
      ]);
      const res = await service.ingest(dto(), 'admin');
      const where = prisma.payment.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ gateway: 'MANUAL', status: { in: ['INITIATED', 'AUTHORIZED'] }, currency: 'MRU' });
      expect(where.amount.toString()).toBe('1500');
      expect(Date.now() - where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(48 * 3_600_000 - 1000);
      expect(prisma.bankNotification.create.mock.calls[0][0].data).toMatchObject({ status: 'SUGGESTED', suggestedPaymentId: PAY });
      expect(res.status).toBe('SUGGESTED');
      const n = staff.notify.mock.calls[0][0];
      expect(n).toMatchObject({ type: 'bank.match', dedupeKey: `bank.match:${ID}`, data: { paymentId: PAY, orderId: 'o1' } });
      expect(n.title).toContain('PTN-7');
      expect(n.body).toContain('ليس دليلاً');
    });

    it('a payment without a transfer report still matches on the amount', async () => {
      prisma.payment.findMany.mockResolvedValueOnce([{ id: PAY, amount: new Prisma.Decimal('1500'), currency: 'MRU', status: 'INITIATED', createdAt: new Date(), rawResponse: null }]);
      prisma.payment.findUnique.mockResolvedValueOnce(null);
      await expect(service.ingest(dto({ text: 'تم استلام 1500 أوقية' }), 'admin')).resolves.toMatchObject({ status: 'SUGGESTED' });
    });

    it('an outgoing transfer is stored but not matched and raises nothing', async () => {
      const res = await service.ingest(dto({ text: 'تم تحويل 3000 أوقية إلى 44556677', title: undefined }), 'admin');
      expect(res.status).toBe('NEW');
      expect(prisma.payment.findMany).not.toHaveBeenCalled();
      expect(staff.notify).not.toHaveBeenCalled();
      expect(prisma.bankNotification.create.mock.calls[0][0].data.title).toBeNull();
    });

    it('an unreadable notice is still kept for the owner', async () => {
      const res = await service.ingest(dto({ text: 'Bienvenue', title: '   ' }), 'admin');
      expect(res).toMatchObject({ status: 'NEW', amount: null });
      expect(staff.notify.mock.calls[0][0].body).toContain('مبلغ غير مقروء');
    });

    it('refuses a text that is empty once cleaned', async () => {
      await expect(service.ingest(dto({ text: '‏ \u0000' }), 'admin')).rejects.toMatchObject({ response: expect.objectContaining({ error: 'BANK_NOTICE_EMPTY' }) });
    });
  });

  describe('list', () => {
    it('shows what still needs the owner first, then the rest, with the payment it points at', async () => {
      prisma.bankNotification.findMany
        .mockResolvedValueOnce([stored({ status: 'SUGGESTED', suggestedPaymentId: PAY })])
        .mockResolvedValueOnce([stored({ id: 'x2', status: 'IGNORED' })]);
      prisma.payment.findMany.mockResolvedValueOnce([
        { id: PAY, orderId: 'o1', amount: new Prisma.Decimal('1500'), currency: 'MRU', status: 'AUTHORIZED', order: { orderNumber: 'PTN-7' } },
      ]);
      const { data } = await service.list();
      expect(prisma.bankNotification.findMany.mock.calls[0][0].where).toEqual({ status: { in: ['NEW', 'SUGGESTED'] } });
      expect(prisma.bankNotification.findMany.mock.calls[1][0]).toMatchObject({ where: { status: { notIn: ['NEW', 'SUGGESTED'] } }, take: 49 });
      expect(data.map((d) => d.status)).toEqual(['SUGGESTED', 'IGNORED']);
      expect(data[0]).toMatchObject({
        amount: '1500', duplicate: false,
        suggestedPayment: { id: PAY, orderId: 'o1', orderNumber: 'PTN-7', amount: '1500', currency: 'MRU', status: 'AUTHORIZED' },
        matchedPayment: null,
        orderId: 'o1',
        orderNumber: 'PTN-7',
      });
      expect(data[1]).toMatchObject({ orderId: null, orderNumber: null });
    });

    it('filters by status, and skips the second query when the first fills the page', async () => {
      prisma.bankNotification.findMany.mockResolvedValueOnce([stored({ status: 'DUPLICATE' })]);
      const { data } = await service.list('DUPLICATE', 10);
      expect(prisma.bankNotification.findMany.mock.calls[0][0]).toMatchObject({ where: { status: 'DUPLICATE' }, take: 10 });
      expect(data[0].duplicate).toBe(true);
      expect(prisma.payment.findMany).not.toHaveBeenCalled();

      prisma.bankNotification.findMany.mockResolvedValueOnce([stored()]);
      await service.list(undefined, 1);
      expect(prisma.bankNotification.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('confirm', () => {
    beforeEach(() => {
      prisma.bankNotification.findUnique.mockResolvedValue(stored({ status: 'SUGGESTED', suggestedPaymentId: PAY }));
    });

    it('records only the link and the reviewer; the payment is not touched', async () => {
      await service.confirm(ID, PAY, 'admin');
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.bankNotification.updateMany).toHaveBeenCalledWith({
        where: { id: ID, status: { in: ['NEW', 'SUGGESTED'] } },
        data: { status: 'CONFIRMED', matchedPaymentId: PAY, reviewedById: 'admin', reviewedAt: expect.any(Date) },
      });
      expect(tx.payment).not.toHaveProperty('update');
      expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'bank_notices.confirm' }));
      expect(staff.resolve).toHaveBeenCalledWith(`bank.match:${ID}`);
      expect(staff.resolve).toHaveBeenCalledWith(`bank.unmatched:${ID}`);
    });

    it('refuses a missing notice, a duplicate, a reviewed one, a non-manual payment and a payment already linked', async () => {
      prisma.bankNotification.findUnique.mockResolvedValueOnce(null);
      await expect(service.confirm(ID, PAY, 'a')).rejects.toBeInstanceOf(NotFoundException);

      prisma.bankNotification.findUnique.mockResolvedValueOnce(stored({ status: 'DUPLICATE' }));
      await expect(service.confirm(ID, PAY, 'a')).rejects.toMatchObject({ response: expect.objectContaining({ error: 'BANK_NOTICE_DUPLICATE' }) });

      prisma.bankNotification.findUnique.mockResolvedValueOnce(stored({ status: 'IGNORED' }));
      await expect(service.confirm(ID, PAY, 'a')).rejects.toMatchObject({ response: expect.objectContaining({ error: 'BANK_NOTICE_REVIEWED' }) });

      tx.payment.findUnique.mockResolvedValueOnce({ id: PAY, gateway: 'WALLET' });
      await expect(service.confirm(ID, PAY, 'a')).rejects.toMatchObject({ response: expect.objectContaining({ error: 'BANK_NOTICE_PAYMENT_INVALID' }) });
      tx.payment.findUnique.mockResolvedValueOnce(null);
      await expect(service.confirm(ID, PAY, 'a')).rejects.toMatchObject({ response: expect.objectContaining({ error: 'BANK_NOTICE_PAYMENT_INVALID' }) });

      tx.bankNotification.findFirst.mockResolvedValueOnce({ id: 'other' });
      await expect(service.confirm(ID, PAY, 'a')).rejects.toMatchObject({ response: expect.objectContaining({ error: 'BANK_NOTICE_PAYMENT_TAKEN' }) });

      tx.bankNotification.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.confirm(ID, PAY, 'a')).rejects.toMatchObject({ response: expect.objectContaining({ error: 'BANK_NOTICE_REVIEWED' }) });
      expect(staff.resolve).not.toHaveBeenCalled();
    });
  });

  describe('ignore', () => {
    it('sets it aside with a note, audited, and closes its staff notice', async () => {
      prisma.bankNotification.findUnique.mockResolvedValue(stored());
      await service.ignore(ID, 'admin', '  تحويل شخصي ');
      expect(tx.bankNotification.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: ID, status: { in: ['NEW', 'SUGGESTED', 'DUPLICATE'] } },
        data: { status: 'IGNORED', reviewedById: 'admin', reviewNote: 'تحويل شخصي' },
      });
      expect(audit.record).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'bank_notices.ignore' }));
      expect(staff.resolve).toHaveBeenCalledWith(`bank.unmatched:${ID}`);

      await service.ignore(ID, 'admin');
      expect(tx.bankNotification.updateMany.mock.calls[1][0].data.reviewNote).toBeNull();
    });

    it('refuses one already reviewed', async () => {
      prisma.bankNotification.findUnique.mockResolvedValue(stored({ status: 'CONFIRMED' }));
      tx.bankNotification.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.ignore(ID, 'admin')).rejects.toMatchObject({ response: expect.objectContaining({ error: 'BANK_NOTICE_REVIEWED' }) });
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});

describe('BankNoticesController', () => {
  it('routes to the service with the caller', async () => {
    const svc = {
      ingest: jest.fn().mockResolvedValue('in'), list: jest.fn().mockResolvedValue('list'), config: jest.fn().mockResolvedValue('cfg'),
      setConfig: jest.fn().mockResolvedValue('set'), confirm: jest.fn().mockResolvedValue('ok'), ignore: jest.fn().mockResolvedValue('ign'),
    };
    const c = new BankNoticesController(svc as any);
    expect(await c.ingest(dto(), 'u1')).toBe('in');
    expect(await c.list({ status: 'NEW', limit: 5 })).toBe('list');
    expect(svc.list).toHaveBeenCalledWith('NEW', 5);
    expect(await c.config()).toBe('cfg');
    expect(await c.setConfig({ allowedApps: [APP] }, 'u1')).toBe('set');
    expect(await c.confirm(ID, { paymentId: PAY }, 'u1')).toBe('ok');
    expect(svc.confirm).toHaveBeenCalledWith(ID, PAY, 'u1');
    expect(await c.ignore(ID, { note: 'n' }, 'u1')).toBe('ign');
  });
});

describe('bank notice DTOs', () => {
  it('accepts the contract body and refuses bad dates and app names', async () => {
    expect(await validate(plainToInstance(IngestBankNoticeDto, dto()))).toHaveLength(0);
    expect(await validate(plainToInstance(IngestBankNoticeDto, dto({ postedAt: 'yesterday' })))).not.toHaveLength(0);
    expect(await validate(plainToInstance(IngestBankNoticeDto, dto({ sourceApp: 'bad app!' })))).not.toHaveLength(0);
    expect(await validate(plainToInstance(IngestBankNoticeDto, dto({ text: 'x'.repeat(4001) })))).not.toHaveLength(0);
    expect(await validate(plainToInstance(BankConfigDto, { allowedApps: [APP] }))).toHaveLength(0);
    expect(await validate(plainToInstance(BankConfigDto, { allowedApps: ['<script>'] }))).not.toHaveLength(0);
  });
});
