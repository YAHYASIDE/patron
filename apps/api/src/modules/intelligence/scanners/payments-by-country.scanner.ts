import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ManualAccount, ManualTransferGateway, isUsable } from '../../payments/gateways/manual.gateway';
import { DiscoveryInput, Scanner } from '../intelligence.types';

export interface PaymentCountry {
  code: string;
  nameAr: string;
}
export interface ActiveMethod {
  id: string;
  countryCode: string;
  key: string;
  name: string;
  accountId: string | null;
}

const ACCOUNTS_REF = 'system_settings:payments.manual_accounts';
/** Only the method's name ever goes into a discovery: never its number, name on the account or instructions. */
const label = (a: ManualAccount) => a.method.trim() || 'حساب بلا اسم';

/**
 * Where money can and cannot go, per country (contract: In-app scanners §2):
 * enabled countries with no usable account listing them, accounts that serve
 * every country (empty `countries`), accounts switched on without a number, and
 * ACTIVE market methods whose account is gone or no longer usable. Reads only;
 * it never touches an account.
 */
export function paymentFindings(accounts: ManualAccount[], countries: PaymentCountry[], methods: ActiveMethod[]): DiscoveryInput[] {
  const out: DiscoveryInput[] = [];
  const usable = accounts.filter(isUsable);
  const everywhere = usable.filter((a) => !a.countries.length);

  for (const c of countries) {
    if (usable.some((a) => a.countries.includes(c.code))) continue;
    const fallback = everywhere.map(label);
    out.push({
      fingerprint: `payments.country-uncovered:${c.code}`,
      kind: 'payment',
      title: `لا يوجد حساب دفع مفعّل لـ ${c.nameAr} (${c.code})`,
      description: fallback.length
        ? `الدولة مفعّلة، ولا يوجد حساب مفعّل برقم يذكرها. يراها زبائنها فقط عبر حسابات بلا دول محددة: ${fallback.join('، ')}.`
        : 'الدولة مفعّلة، ولا يوجد أي حساب مفعّل برقم يخدمها: لا يستطيع زبائنها الدفع بالتحويل.',
      evidence: [{ type: 'db', ref: ACCOUNTS_REF, detail: `${usable.length} حساب صالح، لا شيء منها يذكر ${c.code}` }],
      confidence: 95,
      verified: true,
      severity: fallback.length ? 'MEDIUM' : 'HIGH',
      impact: fallback.length
        ? 'قد يُعرض على الزبون حساب من دولة أخرى لا يستطيع التحويل إليه.'
        : 'زبائن هذه الدولة لا يجدون وسيلة دفع، فلا تكتمل طلباتهم.',
      proposal: `أضف حساب استلام لـ ${c.code} في صفحة وسائل الدفع (بعد موافقتك على وسيلة من سوق الدولة)، أو عطّل الدولة حتى يجهز.`,
    });
  }

  for (const a of accounts) {
    if (!a.countries.length) {
      out.push({
        fingerprint: `payments.account-all-countries:${a.id}`,
        kind: 'payment',
        title: `حساب يخدم كل الدول: ${label(a)}`,
        description: `الحساب «${label(a)}» لا يحدد أي دولة، فيُعرض لزبائن كل الدول${a.enabled ? '' : ' (عند تفعيله)'}.`,
        evidence: [{ type: 'db', ref: `${ACCOUNTS_REF}#${a.id}`, detail: 'countries = []' }],
        confidence: 95,
        verified: true,
        severity: isUsable(a) ? 'MEDIUM' : 'LOW',
        impact: 'زبون من دولة أخرى قد يرى وسيلة لا تعمل في بلده (مثل وسيلة موريتانية لزبون من مالي).',
        proposal: 'حدّد في صفحة وسائل الدفع الدول التي يخدمها هذا الحساب.',
      });
    }
    if (a.enabled && !a.accountNumber.trim()) {
      out.push({
        fingerprint: `payments.account-no-number:${a.id}`,
        kind: 'payment',
        title: `حساب مفعّل بلا رقم: ${label(a)}`,
        description: `الحساب «${label(a)}» مفعّل لكن رقم الاستلام فارغ، فلا يظهر للزبائن.`,
        evidence: [{ type: 'db', ref: `${ACCOUNTS_REF}#${a.id}`, detail: 'enabled = true, accountNumber فارغ' }],
        confidence: 95,
        verified: true,
        severity: 'MEDIUM',
        impact: 'تظن أن الوسيلة متاحة وهي مخفية عن الزبائن.',
        proposal: 'أدخل رقم الاستلام الصحيح في صفحة وسائل الدفع، أو عطّل الحساب.',
      });
    }
  }

  for (const m of methods) {
    const account = m.accountId ? accounts.find((a) => a.id === m.accountId) : undefined;
    const reason = !account
      ? 'الحساب المرتبط لم يعد موجودًا'
      : !isUsable(account)
        ? 'الحساب المرتبط معطّل أو بلا رقم'
        : account.countries.length && !account.countries.includes(m.countryCode)
          ? `الحساب المرتبط لم يعد يذكر ${m.countryCode}`
          : null;
    if (!reason) continue;
    out.push({
      fingerprint: `market.method-account-unusable:${m.id}`,
      kind: 'payment',
      title: `وسيلة مفعّلة في ${m.countryCode} بلا حساب صالح: ${m.name}`,
      description: `الوسيلة «${m.name}» (${m.key}) حالتها ACTIVE في ${m.countryCode}، لكن ${reason}.`,
      evidence: [
        { type: 'db', ref: `market_payment_methods:${m.countryCode}/${m.key}` },
        { type: 'db', ref: ACCOUNTS_REF, detail: reason },
      ],
      confidence: 95,
      verified: true,
      severity: 'HIGH',
      impact: 'السوق يعرض الوسيلة على أنها مفعّلة، والزبون لا يجد أين يحوّل.',
      proposal: 'أصلح الحساب في صفحة وسائل الدفع ثم أعد ربطه بالوسيلة، أو أعد الوسيلة إلى المراجعة.',
    });
  }
  return out;
}

@Injectable()
export class PaymentsByCountryScanner implements Scanner {
  readonly name = 'payments-by-country' as const;

  constructor(
    private prisma: PrismaService,
    private manual: ManualTransferGateway,
  ) {}

  async scan(): Promise<DiscoveryInput[]> {
    const [accounts, countries, methods] = await Promise.all([
      this.manual.accounts(),
      this.prisma.marketCountry.findMany({ where: { enabled: true }, select: { code: true, nameAr: true }, orderBy: { code: 'asc' } }),
      this.prisma.marketPaymentMethod.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, countryCode: true, key: true, name: true, accountId: true },
      }),
    ]);
    return paymentFindings(accounts, countries, methods);
  }
}
