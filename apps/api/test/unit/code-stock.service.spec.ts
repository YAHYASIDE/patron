import { NotFoundException } from '@nestjs/common';
import { CodeStockService } from '../../src/modules/catalog/code-stock.service';

describe('CodeStockService', () => {
  let prisma: any;
  let audit: any;
  let service: CodeStockService;
  const crypto = {
    sha256: (v: string) => `h:${v}`,
    encrypt: (v: string) => `enc:${v}`,
    decrypt: (v: string) => v.replace(/^enc:/, ''),
  };

  beforeEach(() => {
    const tx = { productCode: { createMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    prisma = {
      tx,
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1' }) },
      productCode: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    service = new CodeStockService(prisma, crypto as any, audit);
  });

  it('stores pasted codes encrypted, with a hash, skipping blanks and repeats', async () => {
    const res = await service.add('p1', { codes: [' AAA-111 ', '', 'BBB-222', 'AAA-111'] }, 'admin');

    const rows = prisma.tx.productCode.createMany.mock.calls[0][0].data;
    expect(rows.map((r: any) => r.codeEnc)).toEqual(['enc:AAA-111', 'enc:BBB-222']);
    expect(rows.map((r: any) => r.codeHash)).toEqual(['h:AAA-111', 'h:BBB-222']);
    expect(res).toMatchObject({ added: 2, duplicates: 2 });
  });

  it('never stocks a code that is already in stock or was sold', async () => {
    // findMany: first the duplicate check, then the summary's recent list
    prisma.productCode.findMany.mockResolvedValueOnce([{ codeHash: 'h:AAA-111' }]);
    const res = await service.add('p1', { codes: ['AAA-111', 'CCC-333'] }, 'admin');

    const rows = prisma.tx.productCode.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(res).toMatchObject({ added: 1, duplicates: 1 });
  });

  it('audits counts only, never the codes', async () => {
    await service.add('p1', { codes: ['SECRET-CODE'] }, 'admin');
    expect(JSON.stringify(audit.record.mock.calls[0][1])).not.toContain('SECRET-CODE');
  });

  it('refuses an unknown product', async () => {
    prisma.product.findFirst.mockResolvedValue(null);
    await expect(service.add('nope', { codes: ['A'] }, 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('summarises stock and masks recent codes', async () => {
    prisma.productCode.count.mockResolvedValueOnce(4).mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    prisma.productCode.findMany.mockResolvedValue([{ id: 'c1', codeEnc: 'enc:ABCD-EFGH-1234', isUsed: false }]);

    const s = await service.summary('p1');
    expect(s).toMatchObject({ available: 4, used: 2, expired: 1 });
    expect(s.recent[0]).toMatchObject({ id: 'c1', masked: 'ABC••••234' });
    expect(s.recent[0]).not.toHaveProperty('codeEnc');
  });

  it('removes only a code that was not delivered', async () => {
    await service.remove('p1', 'c1', 'admin');
    expect(prisma.productCode.deleteMany).toHaveBeenCalledWith({ where: { id: 'c1', productId: 'p1', isUsed: false } });

    prisma.productCode.deleteMany.mockResolvedValue({ count: 0 });
    await expect(service.remove('p1', 'sold', 'admin')).rejects.toBeInstanceOf(NotFoundException);
  });
});
