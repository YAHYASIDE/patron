import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

/** The shop's own WhatsApp: customers in a hurry message the owner there. */
export const SUPPORT_WHATSAPP_KEY = 'shop.support_whatsapp';

@Injectable()
export class ShopService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** What the storefront may show about the shop itself. */
  async info(): Promise<{ supportWhatsapp: string | null }> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: SUPPORT_WHATSAPP_KEY } });
    return { supportWhatsapp: typeof row?.value === 'string' && row.value ? row.value : null };
  }

  async setInfo(supportWhatsapp: string, actorId: string) {
    const value = supportWhatsapp.trim();
    await this.prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: SUPPORT_WHATSAPP_KEY },
        update: { value },
        create: { key: SUPPORT_WHATSAPP_KEY, value, group: 'shop', isPublic: true, description: "The shop's WhatsApp number for customers" },
      });
      await this.audit.record(tx, { actorId, action: 'shop.info.update', entityType: 'SystemSetting', entityId: SUPPORT_WHATSAPP_KEY, after: { supportWhatsapp: value } });
    });
    return this.info();
  }
}
