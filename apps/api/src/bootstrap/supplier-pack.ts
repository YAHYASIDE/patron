/* eslint-disable no-console */
/**
 * GamesDrop catalog links (owner's request, 14 Nov 2026): every shop product
 * GamesDrop sells exactly (same game, amount, delivery and card region) is
 * linked to its GamesDrop offer, and 22 denominations the shop lacks are
 * added. The matches and prices come from a read-only pull of GamesDrop's
 * catalog for Mauritania on that day.
 *
 * Money rules (the owner asked that our prices sit clearly above the
 * supplier's):
 * - a linked product sells for at least cost × 1.10 after its discount; a
 *   lower price is raised, a higher one is never lowered;
 * - the same floor holds for a fixed price in another currency (MRU, XOF…),
 *   converted at the active rate and rounded up to that currency's step;
 * - the link's most-we-pay is cost + 3% (room for small supplier moves),
 *   always below the selling price, so a supplier rise sends the order to
 *   manual delivery instead of selling at a loss;
 * - automatic delivery stays OFF on every link and every new product is
 *   created hidden: the owner switches each one on from the dashboard.
 *
 * Runs once (marker `supplier.pack.gamesdrop.v1`), only after GamesDrop has
 * been connected in «المورّدون»: until then it waits and retries on the next
 * boot. A link or price the owner already set up by hand is left alone, and
 * every raised price is recorded in the marker so it can be reviewed.
 */
import { DeliveryMode, Prisma, PrismaClient, ProductType } from '@prisma/client';

export const SUPPLIER_PACK_KEY = 'supplier.pack.gamesdrop.v1';
export const PROVIDER_CODE = 'gamesdrop';
export const MARKUP = 1.1;
export const COST_SLACK = 1.03;

type NewProduct = {
  sku: string;
  like: string;
  nameAr: string;
  nameEn: string;
  offer: string;
  cost: number;
  type: ProductType | undefined;
};

/** Up to the next cent, without float noise (0.1 + 0.2 must not become 0.31). */
export const ceilCents = (v: number) => Math.ceil(Math.round(v * 1e6) / 1e4) / 100;
const round2 = (v: number) => Math.round(v * 100) / 100;

/** The lowest price a customer may pay for something that costs `cost`. */
export const floorPrice = (cost: number) => ceilCents(cost * MARKUP);

/** The list price that still meets the floor once the product's discount is taken off. */
export function listPriceFor(cost: number, discountPercent: number | null | undefined) {
  const d = discountPercent && discountPercent > 0 ? discountPercent : 0;
  return d ? ceilCents(floorPrice(cost) / (1 - d / 100)) : floorPrice(cost);
}

/** The most the engine may pay GamesDrop: a little above today's cost, never at or above what we sell for. */
export const maxCost = (cost: number, sell: number) =>
  Math.min(ceilCents(cost * COST_SLACK), round2(sell - 0.01));

/** [shop SKU, GamesDrop offer id, GamesDrop price in USD on 14 Nov 2026] */
export const GAMESDROP_LINKS: Array<[string, string, number]> = [
  ['APP-BIGO-200', '2410', 3.77],
  ['APP-BIGO-500', '2399', 9.41],
  ['GC-APPLE-US-10', '376', 10.09],
  ['GC-APPLE-US-100', '382', 100.9],
  ['GC-APPLE-US-25', '379', 25.22],
  ['GC-APPLE-US-50', '381', 50.45],
  ['GC-MINECRAFT-1720', '19304', 6.54],
  ['GC-NINTENDO-US-10', '24', 9.34],
  ['GC-NINTENDO-US-20', '25', 18.39],
  ['GC-NINTENDO-US-35', '26', 31.31],
  ['GC-NINTENDO-US-50', '27', 44.54],
  ['GC-PSN-US-10', '7', 9.67],
  ['GC-PSN-US-100', '11', 96.7],
  ['GC-PSN-US-25', '8', 24.17],
  ['GC-PSN-US-50', '9', 48.35],
  ['GC-RAZER-10', '64', 9.77],
  ['GC-RAZER-50', '66', 48.86],
  ['GC-ROBLOX-10', '18677', 10.08],
  ['GC-ROBLOX-25', '18679', 24.91],
  ['GC-ROBLOX-50', '82369', 48.4],
  ['GC-XBOX-US-15', '19', 14.43],
  ['GC-XBOX-US-25', '21', 24.05],
  ['GC-XBOX-US-50', '22', 48.1],
  ['SUB-DISCORD-BASIC-12M', '68666', 31.24],
  ['SUB-DISCORD-BASIC-1M', '62022', 3.22],
  ['SUB-DISCORD-NITRO-12M', '68481', 76.62],
  ['SUB-DISCORD-NITRO-1M', '62021', 7.95],
  ['SUB-TGPREMIUM-12M', '461', 30.0],
  ['SUB-TGPREMIUM-3M', '459', 12.41],
  ['SUB-TGPREMIUM-6M', '460', 16.55],
  ['TOP-FF-100', '16529', 1.03],
  ['TOP-FF-1080', '16530', 10.34],
  ['TOP-FF-210', '16532', 2.07],
  ['TOP-FF-2200', '16531', 20.68],
  ['TOP-FF-530', '16533', 5.17],
  ['TOP-MLBB-172', '283', 2.16],
  ['TOP-MLBB-257', '284', 3.09],
  ['TOP-MLBB-706', '93', 8.49],
  ['TOP-MLBB-86', '282', 1.09],
  ['TOP-PUBG-1800', '127', 23.08],
  ['TOP-PUBG-325', '125', 4.61],
  ['TOP-PUBG-3850', '128', 46.15],
  ['TOP-PUBG-60', '371', 0.92],
  ['TOP-PUBG-660', '126', 9.23],
  ['TOP-PUBG-8100', '129', 92.32],
];

export const GAMESDROP_NEW: NewProduct[] = [
  {
    sku: 'TOP-MLBB-WEEKLY',
    like: 'TOP-MLBB-86',
    nameAr: 'موبايل ليجندز اشتراك الماس الأسبوعي',
    nameEn: 'Mobile Legends Weekly Diamond Pass',
    offer: '280',
    cost: 1.34,
    type: undefined,
  },
  {
    sku: 'TOP-MLBB-TWILIGHT',
    like: 'TOP-MLBB-86',
    nameAr: 'موبايل ليجندز باس الشفق',
    nameEn: 'Mobile Legends Twilight Pass',
    offer: '281',
    cost: 7.12,
    type: undefined,
  },
  {
    sku: 'TOP-MLBB-344',
    like: 'TOP-MLBB-86',
    nameAr: 'موبايل ليجندز 344 جوهرة',
    nameEn: 'Mobile Legends 344 Diamonds',
    offer: '1183',
    cost: 4.32,
    type: undefined,
  },
  {
    sku: 'TOP-MLBB-514',
    like: 'TOP-MLBB-86',
    nameAr: 'موبايل ليجندز 514 جوهرة',
    nameEn: 'Mobile Legends 514 Diamonds',
    offer: '285',
    cost: 6.19,
    type: undefined,
  },
  {
    sku: 'TOP-MLBB-878',
    like: 'TOP-MLBB-86',
    nameAr: 'موبايل ليجندز 878 جوهرة',
    nameEn: 'Mobile Legends 878 Diamonds',
    offer: '467',
    cost: 10.64,
    type: undefined,
  },
  {
    sku: 'TOP-MLBB-2195',
    like: 'TOP-MLBB-86',
    nameAr: 'موبايل ليجندز 2195 جوهرة',
    nameEn: 'Mobile Legends 2195 Diamonds',
    offer: '469',
    cost: 25.69,
    type: undefined,
  },
  {
    sku: 'TOP-MLBB-3688',
    like: 'TOP-MLBB-86',
    nameAr: 'موبايل ليجندز 3688 جوهرة',
    nameEn: 'Mobile Legends 3688 Diamonds',
    offer: '94',
    cost: 42.86,
    type: undefined,
  },
  {
    sku: 'APP-BIGO-100',
    like: 'APP-BIGO-200',
    nameAr: 'بيجو لايف 100 ماسة',
    nameEn: 'Bigo Live 100 Diamonds',
    offer: '2401',
    cost: 1.87,
    type: undefined,
  },
  {
    sku: 'APP-BIGO-300',
    like: 'APP-BIGO-200',
    nameAr: 'بيجو لايف 300 ماسة',
    nameEn: 'Bigo Live 300 Diamonds',
    offer: '2412',
    cost: 5.64,
    type: undefined,
  },
  {
    sku: 'APP-BIGO-1000',
    like: 'APP-BIGO-200',
    nameAr: 'بيجو لايف 1000 ماسة',
    nameEn: 'Bigo Live 1000 Diamonds',
    offer: '2403',
    cost: 18.83,
    type: undefined,
  },
  {
    sku: 'SUB-TGSTARS-100',
    like: 'SUB-TGPREMIUM-3M',
    nameAr: 'نجوم تيليجرام 100',
    nameEn: 'Telegram Stars 100',
    offer: '3822',
    cost: 1.56,
    type: ProductType.GAME_TOPUP,
  },
  {
    sku: 'SUB-TGSTARS-250',
    like: 'SUB-TGPREMIUM-3M',
    nameAr: 'نجوم تيليجرام 250',
    nameEn: 'Telegram Stars 250',
    offer: '3831',
    cost: 3.88,
    type: ProductType.GAME_TOPUP,
  },
  {
    sku: 'SUB-TGSTARS-500',
    like: 'SUB-TGPREMIUM-3M',
    nameAr: 'نجوم تيليجرام 500',
    nameEn: 'Telegram Stars 500',
    offer: '3829',
    cost: 7.77,
    type: ProductType.GAME_TOPUP,
  },
  {
    sku: 'SUB-TGSTARS-1000',
    like: 'SUB-TGPREMIUM-3M',
    nameAr: 'نجوم تيليجرام 1000',
    nameEn: 'Telegram Stars 1000',
    offer: '75887',
    cost: 15.53,
    type: ProductType.GAME_TOPUP,
  },
  {
    sku: 'SUB-DISCORD-NITRO-3M',
    like: 'SUB-DISCORD-NITRO-1M',
    nameAr: 'ديسكورد نيترو 3 أشهر',
    nameEn: 'Discord Nitro 3 months',
    offer: '68483',
    cost: 25.0,
    type: undefined,
  },
  {
    sku: 'SUB-DISCORD-NITRO-6M',
    like: 'SUB-DISCORD-NITRO-1M',
    nameAr: 'ديسكورد نيترو 6 أشهر',
    nameEn: 'Discord Nitro 6 months',
    offer: '68482',
    cost: 49.95,
    type: undefined,
  },
  {
    sku: 'GC-APPLE-US-5',
    like: 'GC-APPLE-US-10',
    nameAr: 'بطاقة آيتونز / آبل 5$',
    nameEn: 'Apple / iTunes card $5 (US)',
    offer: '375',
    cost: 5.01,
    type: undefined,
  },
  {
    sku: 'GC-APPLE-US-20',
    like: 'GC-APPLE-US-10',
    nameAr: 'بطاقة آيتونز / آبل 20$',
    nameEn: 'Apple / iTunes card $20 (US)',
    offer: '378',
    cost: 20.19,
    type: undefined,
  },
  {
    sku: 'GC-PSN-US-75',
    like: 'GC-PSN-US-50',
    nameAr: 'بطاقة بلايستيشن 75$',
    nameEn: 'PlayStation card $75 (US)',
    offer: '10',
    cost: 70.16,
    type: undefined,
  },
  {
    sku: 'GC-XBOX-US-10',
    like: 'GC-XBOX-US-15',
    nameAr: 'بطاقة إكس بوكس 10$',
    nameEn: 'Xbox card $10 (US)',
    offer: '18',
    cost: 9.62,
    type: undefined,
  },
  {
    sku: 'GC-RAZER-20',
    like: 'GC-RAZER-10',
    nameAr: 'بطاقة رازر جولد 20$',
    nameEn: 'Razer Gold card $20',
    offer: '65',
    cost: 19.55,
    type: undefined,
  },
  {
    sku: 'GC-RAZER-100',
    like: 'GC-RAZER-10',
    nameAr: 'بطاقة رازر جولد 100$',
    nameEn: 'Razer Gold card $100',
    offer: '67',
    cost: 97.73,
    type: undefined,
  },
];

type Db = PrismaClient | Prisma.TransactionClient;
type Change = { sku: string; currency: string; from: number; to: number };

/** Active USD → X rates (latest first wins) and each currency's rounding step. */
export async function currencyTable(prisma: Db) {
  const rates = new Map<string, number>();
  const rows = await prisma.fxRate.findMany({
    where: { baseCurrency: 'USD', isActive: true },
    orderBy: { effectiveAt: 'desc' },
  });
  for (const r of rows) if (!rates.has(r.quoteCurrency)) rates.set(r.quoteCurrency, Number(r.rate));
  const steps = new Map<string, number>();
  for (const c of await prisma.currency.findMany()) {
    steps.set(c.code, c.roundingStep !== null ? Number(c.roundingStep) : 10 ** -c.decimals);
  }
  return { rates, steps };
}

export const ceilTo = (v: number, step: number) =>
  step > 0 ? Math.ceil(Math.round((v / step) * 1e6) / 1e6) * step : v;

export async function applySupplierPack(client?: PrismaClient): Promise<Record<string, unknown> | null> {
  const root = client ?? new PrismaClient();
  try {
    // all or nothing: a crash half-way leaves no marker and no half-raised prices
    return await root.$transaction((tx) => apply(tx), { maxWait: 10_000, timeout: 120_000 });
  } finally {
    if (!client) await root.$disconnect();
  }
}

async function apply(prisma: Prisma.TransactionClient): Promise<Record<string, unknown> | null> {
  {
    if (await prisma.systemSetting.findUnique({ where: { key: SUPPLIER_PACK_KEY } })) {
      console.log(`supplier pack: ${SUPPLIER_PACK_KEY} already applied, skipping`);
      return null;
    }
    const provider = await prisma.provider.findUnique({ where: { code: PROVIDER_CODE } });
    if (!provider) {
      console.log('supplier pack: GamesDrop is not connected yet; will try again on the next start');
      return null;
    }
    const { rates, steps } = await currencyTable(prisma);
    const done = {
      linked: 0,
      keptOwnerLinks: 0,
      offerTaken: 0,
      raised: 0,
      overridesRaised: 0,
      created: 0,
      missing: [] as string[],
    };
    const changes: Change[] = [];

    const priceAndLink = async (
      product: {
        id: string;
        sku: string;
        sellPrice: Prisma.Decimal;
        discountPercent: number | null;
        currency: string;
      },
      offer: string,
      cost: number,
    ) => {
      const floor = floorPrice(cost);
      const list = listPriceFor(cost, product.discountPercent);
      const sell = Number(product.sellPrice);
      const newSell = sell < list ? list : sell;
      if (newSell !== sell) {
        changes.push({ sku: product.sku, currency: product.currency, from: sell, to: newSell });
        done.raised++;
      }
      await prisma.product.update({
        where: { id: product.id },
        data: { sellPrice: newSell, costPrice: cost },
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
        changes.push({ sku: product.sku, currency: o.currencyCode, from: Number(o.sellPrice), to: min });
        done.overridesRaised++;
      }

      // the owner's own link stays as it is; one offer serves one product
      const mine = await prisma.productProvider.findUnique({
        where: { productId_providerId: { productId: product.id, providerId: provider.id } },
      });
      if (mine) {
        done.keptOwnerLinks++;
        return;
      }
      if (
        await prisma.productProvider.findUnique({
          where: { providerId_providerSku: { providerId: provider.id, providerSku: offer } },
        })
      ) {
        done.offerTaken++;
        return;
      }
      await prisma.productProvider.create({
        data: {
          productId: product.id,
          providerId: provider.id,
          providerSku: offer,
          providerCost: maxCost(cost, newSell),
          isActive: false,
        },
      });
      done.linked++;
    };

    for (const [sku, offer, cost] of GAMESDROP_LINKS) {
      const product = await prisma.product.findUnique({ where: { sku } });
      if (!product || product.deletedAt) {
        done.missing.push(sku);
        continue;
      }
      await priceAndLink(product, offer, cost);
    }

    for (const n of GAMESDROP_NEW) {
      let product = await prisma.product.findUnique({ where: { sku: n.sku } });
      if (product?.deletedAt) {
        done.missing.push(n.sku); // the owner deleted it: never bring it back
        continue;
      }
      if (!product) {
        const like = await prisma.product.findUnique({ where: { sku: n.like } });
        if (!like) {
          done.missing.push(n.sku);
          continue;
        }
        product = await prisma.product.create({
          data: {
            sku: n.sku,
            type: n.type ?? like.type,
            delivery: DeliveryMode.MANUAL,
            nameAr: n.nameAr,
            nameEn: n.nameEn,
            description: like.description,
            imageUrl: like.imageUrl,
            costPrice: n.cost,
            sellPrice: floorPrice(n.cost),
            currency: like.currency,
            maxPerOrder: like.maxPerOrder,
            etaMinutes: like.etaMinutes,
            metadata: (like.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
            categoryId: like.categoryId,
            gameId: like.gameId,
            isActive: false, // hidden until the owner reviews the price and shows it
          },
        });
        done.created++;
      }
      await priceAndLink(product, n.offer, n.cost);
    }

    const value = { appliedAt: new Date().toISOString(), ...done, changes };
    await prisma.systemSetting.create({
      data: {
        key: SUPPLIER_PACK_KEY,
        group: 'catalog',
        description:
          'GamesDrop links (auto delivery off), 22 hidden new products, prices raised to cost + 10% where lower (once).',
        value: value as unknown as Prisma.InputJsonValue,
      },
    });
    console.log(
      `supplier pack: ${SUPPLIER_PACK_KEY} applied`,
      JSON.stringify({ ...done, changes: changes.length }),
    );
    return value;
  }
}

export const SUPPLIER_SHOW_KEY = 'supplier.pack.gamesdrop.show-new.v1';

/**
 * The owner then asked (14 Nov 2026) to show the 22 new products instead of
 * reviewing them one by one. Once, after the links pack: every one still
 * hidden is shown; a product the owner deleted stays deleted. A product hidden
 * again later from the dashboard is not touched (the marker stops a re-run).
 */
export async function showNewSupplierProducts(client?: PrismaClient): Promise<number | null> {
  const prisma = client ?? new PrismaClient();
  try {
    if (await prisma.systemSetting.findUnique({ where: { key: SUPPLIER_SHOW_KEY } })) return null;
    if (!(await prisma.systemSetting.findUnique({ where: { key: SUPPLIER_PACK_KEY } }))) return null; // not created yet
    const res = await prisma.product.updateMany({
      where: { sku: { in: GAMESDROP_NEW.map((n) => n.sku) }, deletedAt: null, isActive: false },
      data: { isActive: true },
    });
    await prisma.systemSetting.create({
      data: {
        key: SUPPLIER_SHOW_KEY,
        group: 'catalog',
        description: 'Showed the GamesDrop new products the owner asked to publish (once).',
        value: { appliedAt: new Date().toISOString(), shown: res.count } as Prisma.InputJsonValue,
      },
    });
    console.log(`supplier pack: showed ${res.count} new products`);
    return res.count;
  } finally {
    if (!client) await prisma.$disconnect();
  }
}

// ───────────────────────── Binance gift cards (owner's real test) ─────────────────────────

export const SUPPLIER_BINANCE_KEY = 'supplier.pack.gamesdrop.binance.v1';

const binanceText = (usdt: number) =>
  `بطاقة هدايا بينانس بقيمة ${usdt} USDT. بعد تأكيد الدفع يصلك رمز البطاقة في صفحة طلبك؛ افتح تطبيق بينانس ← المحفظة ← Gift Card ← استرداد (Redeem) والصق الرمز فتُضاف ${usdt} USDT إلى حسابك.`;

/**
 * [SKU, USDT value, GamesDrop offer, GamesDrop price on 14 Nov 2026, automatic delivery].
 * Binance gift cards (USDT, "RoW", allowed for Mauritania) are delivered as a code.
 * 10/25/50 existed hidden and priced below what GamesDrop charges; 1 and 5 are new,
 * cheap cards for the owner's first real purchase. Only the 1 USDT card buys
 * automatically: the owner's real end-to-end test, at most a few dollars.
 */
export const BINANCE_CARDS: Array<[string, number, string, number, boolean]> = [
  ['GC-BINANCE-1', 1, '34262', 1.28, true],
  ['GC-BINANCE-5', 5, '17450', 5.79, false],
  ['GC-BINANCE-10', 10, '17449', 11.4, false],
  ['GC-BINANCE-25', 25, '34260', 28.33, false],
  ['GC-BINANCE-50', 50, '17394', 56.32, false],
];

/**
 * Once, after GamesDrop is connected: every Binance card is linked, priced at
 * least cost + 10% (never lowered), described as the code it is, and shown; the
 * new cards are shaped like GC-BINANCE-10. A card the owner deleted stays deleted.
 */
export async function applyBinancePack(client?: PrismaClient): Promise<Record<string, unknown> | null> {
  const root = client ?? new PrismaClient();
  try {
    return await root.$transaction(
      async (prisma) => {
        if (await prisma.systemSetting.findUnique({ where: { key: SUPPLIER_BINANCE_KEY } })) return null;
        const provider = await prisma.provider.findUnique({ where: { code: PROVIDER_CODE } });
        if (!provider) return null; // waits for the connection, like the links pack
        const like = await prisma.product.findUnique({ where: { sku: 'GC-BINANCE-10' } });
        const done = { created: 0, linked: 0, keptOwnerLinks: 0, auto: 0, shown: 0, missing: [] as string[] };
        const changes: Change[] = [];

        for (const [sku, usdt, offer, cost, auto] of BINANCE_CARDS) {
          let product = await prisma.product.findUnique({ where: { sku } });
          if (product?.deletedAt) {
            done.missing.push(sku);
            continue;
          }
          if (!product) {
            if (!like) {
              done.missing.push(sku);
              continue;
            }
            product = await prisma.product.create({
              data: {
                sku,
                type: like.type,
                delivery: DeliveryMode.MANUAL,
                nameAr: `بطاقة هدايا بينانس ${usdt} USDT`,
                nameEn: `Binance Gift Card ${usdt} USDT`,
                description: binanceText(usdt),
                imageUrl: like.imageUrl,
                costPrice: cost,
                sellPrice: floorPrice(cost),
                currency: like.currency,
                maxPerOrder: like.maxPerOrder,
                etaMinutes: like.etaMinutes,
                metadata: (like.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
                categoryId: like.categoryId,
                gameId: like.gameId,
                isActive: true,
              },
            });
            done.created++;
          }
          const list = listPriceFor(cost, product.discountPercent);
          const sell = Number(product.sellPrice);
          const newSell = sell < list ? list : sell;
          if (newSell !== sell) changes.push({ sku, currency: product.currency, from: sell, to: newSell });
          if (!product.isActive) done.shown++;
          await prisma.product.update({
            where: { id: product.id },
            data: { sellPrice: newSell, costPrice: cost, description: binanceText(usdt), isActive: true },
          });

          const mine = await prisma.productProvider.findUnique({
            where: { productId_providerId: { productId: product.id, providerId: provider.id } },
          });
          if (mine) {
            done.keptOwnerLinks++;
            continue;
          }
          if (
            await prisma.productProvider.findUnique({
              where: { providerId_providerSku: { providerId: provider.id, providerSku: offer } },
            })
          )
            continue;
          await prisma.productProvider.create({
            data: {
              productId: product.id,
              providerId: provider.id,
              providerSku: offer,
              providerCost: maxCost(cost, newSell),
              isActive: auto && provider.isActive,
            },
          });
          done.linked++;
          if (auto && provider.isActive) {
            await prisma.product.update({
              where: { id: product.id },
              data: { delivery: DeliveryMode.AUTO_PROVIDER },
            });
            done.auto++;
          }
        }

        const value = { appliedAt: new Date().toISOString(), ...done, changes };
        await prisma.systemSetting.create({
          data: {
            key: SUPPLIER_BINANCE_KEY,
            group: 'catalog',
            description:
              'Binance gift cards linked to GamesDrop and shown; the 1 USDT card delivers automatically (once).',
            value: value as unknown as Prisma.InputJsonValue,
          },
        });
        console.log(
          `supplier pack: ${SUPPLIER_BINANCE_KEY} applied`,
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
