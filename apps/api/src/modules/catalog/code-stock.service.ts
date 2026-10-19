import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AuditService } from '../../common/audit/audit.service';
import { AddCodesDto } from './dto/catalog.dto';

/** "ABCD-EFGH-1234" → "ABC••••234": enough for the owner to recognise a code, not to use it. */
function mask(code: string): string {
  if (code.length <= 6) return '•'.repeat(code.length);
  return `${code.slice(0, 3)}••••${code.slice(-3)}`;
}

/**
 * Codes the owner buys in advance and uploads per product. They are stored
 * encrypted, and a hash of each makes stocking the same code twice impossible.
 * OrdersService.deliverFromStock hands them out once an order is paid.
 */
@Injectable()
export class CodeStockService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private audit: AuditService,
  ) {}

  private hash(code: string) {
    return this.crypto.sha256(code.trim());
  }

  async add(productId: string, dto: AddCodesDto, actorId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
    if (!product) throw new NotFoundException('Product not found');

    // one per line, blank lines and repeats within the paste dropped
    const unique = [...new Map(dto.codes.map((c) => c.trim()).filter(Boolean).map((c) => [this.hash(c), c])).entries()];
    const known = await this.prisma.productCode.findMany({
      where: { codeHash: { in: unique.map(([h]) => h) } },
      select: { codeHash: true },
    });
    const taken = new Set(known.map((k) => k.codeHash));
    const fresh = unique.filter(([h]) => !taken.has(h));

    const batchRef = dto.batchRef?.trim() || `upload-${new Date().toISOString().slice(0, 10)}`;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    await this.prisma.$transaction(async (tx) => {
      // skipDuplicates covers a concurrent upload of the same code
      await tx.productCode.createMany({
        data: fresh.map(([codeHash, code]) => ({ productId, codeEnc: this.crypto.encrypt(code), codeHash, batchRef, expiresAt })),
        skipDuplicates: true,
      });
      // counts only: codes never enter the audit log
      await this.audit.record(tx, {
        actorId, action: 'catalog.codes.add', entityType: 'Product', entityId: productId,
        after: { added: fresh.length, duplicates: dto.codes.length - fresh.length, batchRef },
      });
    });

    return { added: fresh.length, duplicates: dto.codes.length - fresh.length, ...(await this.summary(productId)) };
  }

  /** Stock levels and the latest codes, masked. */
  async summary(productId: string) {
    const now = new Date();
    const live = { productId, isUsed: false, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
    const [available, used, expired, recent] = await Promise.all([
      this.prisma.productCode.count({ where: live }),
      this.prisma.productCode.count({ where: { productId, isUsed: true } }),
      this.prisma.productCode.count({ where: { productId, isUsed: false, expiresAt: { lte: now } } }),
      this.prisma.productCode.findMany({
        where: { productId },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: { id: true, codeEnc: true, isUsed: true, usedAt: true, expiresAt: true, batchRef: true, createdAt: true },
      }),
    ]);
    return {
      available,
      used,
      expired,
      recent: recent.map(({ codeEnc, ...r }) => ({ ...r, masked: mask(this.crypto.decrypt(codeEnc)) })),
    };
  }

  /** Remove a code that was stocked by mistake. A delivered code stays as the record of the sale. */
  async remove(productId: string, codeId: string, actorId: string) {
    const { count } = await this.prisma.productCode.deleteMany({ where: { id: codeId, productId, isUsed: false } });
    if (count === 0) throw new NotFoundException('Code not found or already delivered');
    await this.prisma.$transaction((tx) =>
      this.audit.record(tx, { actorId, action: 'catalog.codes.remove', entityType: 'Product', entityId: productId, after: { codeId } }),
    );
    return this.summary(productId);
  }
}
