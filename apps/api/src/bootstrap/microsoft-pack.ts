/* eslint-disable no-console */
/**
 * Windows and Office keys from GamesDrop (owner's request, 15 Nov 2026: «اضف
 * المفاتيح الرمادية وأيضًا مفاتيح مايكروسوفت»). Offers and prices come from a
 * read-only search of GamesDrop's catalog for Mauritania on that day.
 *
 * Two kinds, told apart in the shop:
 * - grey keys (`grey: true`): Windows 11 retail keys and Windows 11 + Office
 *   2021/2024 bundles from the key resale market. Far cheaper than Microsoft's
 *   own store, one PC, no Microsoft support, and Microsoft may later revoke
 *   some. Every grey product says so plainly before the customer pays;
 * - Microsoft 365 subscription keys (Personal, Family, Business Standard),
 *   redeemed on the customer's own Microsoft account.
 *
 * Same money rules as the GamesDrop links pack (supplier-pack.ts): at least
 * cost + 10% after the product's discount and in every fixed foreign price, a
 * price is never lowered, and we never pay GamesDrop more than cost + 3% (always
 * below what we sell for). Automatic delivery stays OFF: GamesDrop asks for a
 * region-risk acknowledgement on the Windows offers, which the adapter does not
 * send yet, so the owner delivers the first orders by hand. New products are
 * shown (the owner asked to add them); Personal and Family already exist and
 * keep the owner's price, name and text.
 *
 * Runs once (marker `supplier.pack.gamesdrop.microsoft.v1`) after GamesDrop is
 * connected. A link the owner made by hand and a product the owner deleted are
 * left alone.
 */
import { DeliveryMode, Prisma, PrismaClient, ProductType } from '@prisma/client';
import { artUrl } from './catalog-pack';
import { ceilTo, currencyTable, floorPrice, listPriceFor, maxCost, PROVIDER_CODE } from './supplier-pack';

export const MICROSOFT_PACK_KEY = 'supplier.pack.gamesdrop.microsoft.v1';

export type MicrosoftKey = {
  sku: string;
  nameAr: string;
  nameEn: string;
  /** GamesDrop offer id and its price in USD on 15 Nov 2026 */
  offer: string;
  cost: number;
  /** a key-resale-market key: the description carries the warning */
  grey: boolean;
  /** what a new product is created with; an existing one keeps the owner's */
  sell: number;
  description: string;
  metadata: Record<string, unknown>;
};

const GREY_NOTE =
  'تنبيه مهم قبل الشراء: هذا مفتاح من سوق المفاتيح الموزَّعة (مفتاح رمادي) وليس من متجر مايكروسوفت مباشرة، ولذلك سعره أقل بكثير. ' +
  'يعمل على جهاز واحد، ولا يشمل دعمًا رسميًا من مايكروسوفت، وقد تُلغي مايكروسوفت تفعيل بعض هذه المفاتيح لاحقًا. اشترِه إذا كنت تقبل ذلك.';
const WINDOWS_STEPS =
  'تفعيل ويندوز: الإعدادات ← النظام ← التنشيط ← تغيير مفتاح المنتج، ثم الصق المفتاح وأنت متصل بالإنترنت. ' +
  'المفتاح يفعّل عادةً ويندوز 10 من الإصدار نفسه أيضًا.';
const OFFICE_STEPS =
  'تفعيل أوفيس: ثبّت النسخة المذكورة نفسها، ثم افتح Word ← ملف ← حساب ← تغيير مفتاح المنتج والصق مفتاح أوفيس. إن احتجت رابط التثبيت أو مساعدة راسلنا على واتساب.';
const DONT_RETRY = 'إن لم يُفعَّل المفتاح فلا تكرّر المحاولة، وتواصل معنا عبر واتساب فورًا.';

const windowsText = (edition: string) =>
  [
    `مفتاح تفعيل رقمي لويندوز 11 ${edition} (نسخة Retail) لجهاز واحد مدى الحياة، يصلك في صفحة طلبك.`,
    GREY_NOTE,
    WINDOWS_STEPS,
    DONT_RETRY,
  ].join('\n\n');
const bundleText = (windows: string, office: string) =>
  [
    `مفتاحان في طلب واحد: ويندوز 11 ${windows} + ${office} (وورد وإكسل وباوربوينت وأوتلوك) لجهاز واحد، بلا اشتراك شهري. يصلان في صفحة طلبك.`,
    GREY_NOTE,
    WINDOWS_STEPS,
    OFFICE_STEPS,
    DONT_RETRY,
  ].join('\n\n');

export const MICROSOFT_KEYS: MicrosoftKey[] = [
  {
    sku: 'LIC-WIN11-HOME',
    nameAr: 'ويندوز 11 هوم',
    nameEn: 'Windows 11 Home key',
    offer: '67626',
    cost: 20.02,
    grey: true,
    sell: 22.99,
    description: windowsText('هوم'),
    metadata: { licenseTerm: 'lifetime', seats: 1, grey: true },
  },
  {
    sku: 'LIC-WIN11-PRO',
    nameAr: 'ويندوز 11 برو',
    nameEn: 'Windows 11 Pro key',
    offer: '61679',
    cost: 22.81,
    grey: true,
    sell: 25.99,
    description: windowsText('برو'),
    metadata: { licenseTerm: 'lifetime', seats: 1, grey: true },
  },
  {
    sku: 'LIC-WINOFFICE-HOME24',
    nameAr: 'ويندوز 11 هوم + أوفيس 2024',
    nameEn: 'Windows 11 Home + Office 2024 Pro Plus',
    offer: '70675',
    cost: 24.66,
    grey: true,
    sell: 27.99,
    description: bundleText('هوم', 'أوفيس 2024 بروفيشنال بلس LTSC'),
    metadata: { licenseTerm: 'lifetime', seats: 1, grey: true },
  },
  {
    sku: 'LIC-WINOFFICE-PRO21',
    nameAr: 'ويندوز 11 برو + أوفيس 2021',
    nameEn: 'Windows 11 Pro + Office 2021 Pro Plus',
    offer: '70754',
    cost: 25.59,
    grey: true,
    sell: 28.99,
    description: bundleText('برو', 'أوفيس 2021 بروفيشنال بلس'),
    metadata: { licenseTerm: 'lifetime', seats: 1, grey: true },
  },
  {
    sku: 'LIC-WINOFFICE-PRO24',
    nameAr: 'ويندوز 11 برو + أوفيس 2024',
    nameEn: 'Windows 11 Pro + Office 2024 Pro Plus',
    offer: '70650',
    cost: 27.43,
    grey: true,
    sell: 30.99,
    description: bundleText('برو', 'أوفيس 2024 بروفيشنال بلس LTSC'),
    metadata: { licenseTerm: 'lifetime', seats: 1, grey: true },
  },
  // Microsoft 365: Personal and Family exist (catalog pack v1); Business is new
  {
    sku: 'LIC-M365-PERSONAL-12M',
    nameAr: 'مايكروسوفت 365 بيرسونال سنة',
    nameEn: 'Microsoft 365 Personal 12 Months',
    offer: '69103',
    cost: 64.51,
    grey: false,
    sell: 105,
    description: '',
    metadata: { licenseTerm: '12 months', seats: 1 },
  },
  {
    sku: 'LIC-M365-FAMILY-12M',
    nameAr: 'مايكروسوفت 365 فاميلي سنة',
    nameEn: 'Microsoft 365 Family 12 Months',
    offer: '76927',
    cost: 101.56,
    grey: false,
    sell: 135,
    description: '',
    metadata: { licenseTerm: '12 months', seats: 6 },
  },
  {
    sku: 'LIC-M365-BUSINESS-12M',
    nameAr: 'مايكروسوفت 365 بزنس ستاندرد سنة',
    nameEn: 'Microsoft 365 Business Standard 12 Months',
    offer: '72513',
    cost: 87.54,
    grey: false,
    sell: 96.99,
    description:
      'مفتاح اشتراك مايكروسوفت 365 بزنس ستاندرد لمدة سنة: وورد وإكسل وباوربوينت وأوتلوك وتيمز و1 تيرابايت تخزين، حتى 15 جهازًا لمستخدم واحد. يصلك المفتاح في صفحة طلبك؛ افتح microsoft365.com/setup وسجّل الدخول بحسابك وأدخل المفتاح فيُضاف الاشتراك إلى حسابك.',
    metadata: { licenseTerm: '12 months', seats: 1, devices: 15 },
  },
];

type Change = { sku: string; currency: string; from: number; to: number };

export async function applyMicrosoftPack(client?: PrismaClient): Promise<Record<string, unknown> | null> {
  const root = client ?? new PrismaClient();
  try {
    return await root.$transaction(
      async (prisma) => {
        if (await prisma.systemSetting.findUnique({ where: { key: MICROSOFT_PACK_KEY } })) return null;
        const provider = await prisma.provider.findUnique({ where: { code: PROVIDER_CODE } });
        if (!provider) {
          console.log('microsoft pack: GamesDrop is not connected yet; will try again on the next start');
          return null;
        }
        const software = await prisma.category.findUnique({ where: { slug: 'software' } });
        const { rates, steps } = await currencyTable(prisma);
        const done = {
          created: 0,
          linked: 0,
          keptOwnerLinks: 0,
          offerTaken: 0,
          raised: 0,
          missing: [] as string[],
        };
        const changes: Change[] = [];

        for (const k of MICROSOFT_KEYS) {
          let product = await prisma.product.findUnique({ where: { sku: k.sku } });
          if (product?.deletedAt) {
            done.missing.push(k.sku); // the owner deleted it: never bring it back
            continue;
          }
          if (!product) {
            if (!software) {
              done.missing.push(k.sku);
              continue;
            }
            product = await prisma.product.create({
              data: {
                sku: k.sku,
                type: ProductType.LICENSE,
                delivery: DeliveryMode.MANUAL,
                nameAr: k.nameAr,
                nameEn: k.nameEn,
                description: k.description,
                imageUrl: artUrl(k.sku),
                costPrice: k.cost,
                sellPrice: Math.max(k.sell, floorPrice(k.cost)),
                currency: 'USD',
                maxPerOrder: 5,
                metadata: k.metadata as Prisma.InputJsonValue,
                categoryId: software.id,
                isActive: true,
              },
            });
            done.created++;
          }

          const floor = floorPrice(k.cost);
          const list = listPriceFor(k.cost, product.discountPercent);
          const sell = Number(product.sellPrice);
          const newSell = sell < list ? list : sell;
          if (newSell !== sell) {
            changes.push({ sku: k.sku, currency: product.currency, from: sell, to: newSell });
            done.raised++;
          }
          await prisma.product.update({
            where: { id: product.id },
            data: { sellPrice: newSell, costPrice: k.cost },
          });

          // a fixed price in another currency must clear the same floor
          const d = product.discountPercent && product.discountPercent > 0 ? product.discountPercent : 0;
          for (const o of await prisma.productPrice.findMany({
            where: { productId: product.id, isActive: true },
          })) {
            if (o.currencyCode === product.currency) continue;
            const rate = rates.get(o.currencyCode);
            if (!rate) continue;
            const min = ceilTo((floor * rate) / (1 - d / 100), steps.get(o.currencyCode) ?? 0.01);
            if (Number(o.sellPrice) >= min) continue;
            await prisma.productPrice.update({ where: { id: o.id }, data: { sellPrice: min } });
            changes.push({ sku: k.sku, currency: o.currencyCode, from: Number(o.sellPrice), to: min });
          }

          if (
            await prisma.productProvider.findUnique({
              where: { productId_providerId: { productId: product.id, providerId: provider.id } },
            })
          ) {
            done.keptOwnerLinks++;
            continue;
          }
          if (
            await prisma.productProvider.findUnique({
              where: { providerId_providerSku: { providerId: provider.id, providerSku: k.offer } },
            })
          ) {
            done.offerTaken++;
            continue;
          }
          await prisma.productProvider.create({
            data: {
              productId: product.id,
              providerId: provider.id,
              providerSku: k.offer,
              providerCost: maxCost(k.cost, newSell),
              isActive: false,
            },
          });
          done.linked++;
        }

        const value = { appliedAt: new Date().toISOString(), ...done, changes };
        await prisma.systemSetting.create({
          data: {
            key: MICROSOFT_PACK_KEY,
            group: 'catalog',
            description:
              'Windows 11 / Office keys and Microsoft 365 linked to GamesDrop (auto delivery off), new ones shown, prices at least cost + 10% (once).',
            value: value as unknown as Prisma.InputJsonValue,
          },
        });
        console.log(
          `microsoft pack: ${MICROSOFT_PACK_KEY} applied`,
          JSON.stringify({ ...done, changes: changes.length }),
        );
        return value;
      },
      { maxWait: 10_000, timeout: 60_000 },
    );
  } finally {
    if (!client) await root.$disconnect();
  }
}
