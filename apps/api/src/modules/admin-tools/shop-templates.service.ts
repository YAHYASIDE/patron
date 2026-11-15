import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { WhatsappTemplateDto } from './admin-tools.dto';

/** Staff-only quick replies; never public (bodies are the owner's wording). */
export const WHATSAPP_TEMPLATES_KEY = 'shop.whatsapp_templates';

export interface WhatsappTemplate {
  id: string;
  title: string;
  body: string;
}

/** WhatsApp quick replies (#44) used on the order page. Bodies may use {name}, {order}, {link}. */
@Injectable()
export class ShopTemplatesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async list(): Promise<WhatsappTemplate[]> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: WHATSAPP_TEMPLATES_KEY } });
    return Array.isArray(row?.value) ? row.value.flatMap((v) => this.read(v)) : [];
  }

  async replace(templates: WhatsappTemplateDto[], actorId: string): Promise<WhatsappTemplate[]> {
    const seen = new Set<string>();
    const value: WhatsappTemplate[] = templates.map((t) => {
      // a repeated id would make two replies edit as one; the second gets a new one
      const id = t.id && !seen.has(t.id) ? t.id : randomUUID();
      seen.add(id);
      return { id, title: t.title.trim(), body: t.body.trim() };
    });

    await this.prisma.$transaction(async (tx) => {
      const before = await tx.systemSetting.findUnique({ where: { key: WHATSAPP_TEMPLATES_KEY } });
      const json = value as unknown as Prisma.InputJsonValue;
      await tx.systemSetting.upsert({
        where: { key: WHATSAPP_TEMPLATES_KEY },
        update: { value: json, isPublic: false },
        create: { key: WHATSAPP_TEMPLATES_KEY, value: json, group: 'shop', isPublic: false, description: 'WhatsApp quick replies for the order page' },
      });
      await this.audit.record(tx, {
        actorId, action: 'shop.templates.update', entityType: 'SystemSetting', entityId: WHATSAPP_TEMPLATES_KEY,
        before: before?.value ?? null, after: value,
      });
    });
    return value;
  }

  /** Tolerate a hand-edited row: keep only well-formed entries. */
  private read(v: Prisma.JsonValue): WhatsappTemplate[] {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return [];
    const { id, title, body } = v as Record<string, unknown>;
    return typeof id === 'string' && typeof title === 'string' && typeof body === 'string' ? [{ id, title, body }] : [];
  }
}
