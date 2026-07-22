/**
 * Patron — database seed
 *   npx prisma db seed
 *
 * Idempotent: safe to run repeatedly (all upserts).
 * Requires ENCRYPTION_KEY (32-byte hex) and SEED_ADMIN_PASSWORD in .env
 */
import { PrismaClient, ProductType, DeliveryMode, DiscountType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { hash as argon2Hash } from '@node-rs/argon2';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

// ─── AES-256-GCM helper (mirrors src/common/crypto in the API) ───
const KEY = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'hex');
function encrypt(plain: string): string {
  if (KEY.length !== 32) throw new Error('ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

// ═══════════════ Permissions ═══════════════

const PERMISSIONS: Array<[string, string, string]> = [
  // key, module, description
  ['users.read', 'users', 'View customers and staff'],
  ['users.write', 'users', 'Create and edit users'],
  ['users.block', 'users', 'Block or unblock a user'],
  ['roles.manage', 'users', 'Manage roles and permissions'],

  ['catalog.read', 'catalog', 'View categories, games, products'],
  ['catalog.write', 'catalog', 'Create and edit catalog entries'],
  ['catalog.delete', 'catalog', 'Soft-delete catalog entries'],
  ['catalog.pricing', 'catalog', 'Change prices and costs'],
  ['codes.manage', 'catalog', 'Import and view code inventory'],

  ['orders.read', 'orders', 'View orders'],
  ['orders.retry', 'orders', 'Retry a failed fulfilment'],
  ['orders.fulfil_manual', 'orders', 'Manually deliver an order item'],
  ['orders.cancel', 'orders', 'Cancel an order'],

  ['payments.read', 'payments', 'View payments'],
  ['payments.refund', 'payments', 'Issue refunds'],
  ['wallet.adjust', 'payments', 'Manually adjust a wallet balance'],

  ['providers.read', 'providers', 'View providers and call logs'],
  ['providers.write', 'providers', 'Configure providers'],
  ['providers.rotate_key', 'providers', 'Rotate provider API credentials'],

  ['coupons.manage', 'marketing', 'Manage coupons'],
  ['banners.manage', 'marketing', 'Manage home banners'],
  ['notifications.send', 'marketing', 'Send broadcast notifications'],

  ['reports.read', 'reports', 'View reports and dashboards'],
  ['reports.export', 'reports', 'Export report data'],

  ['settings.manage', 'system', 'Change platform settings'],
  ['audit.read', 'system', 'Read audit logs'],
];

const ROLE_PERMISSIONS: Record<string, string[] | '*'> = {
  super_admin: '*',
  admin: [
    'users.read', 'users.write', 'users.block',
    'catalog.read', 'catalog.write', 'catalog.delete', 'catalog.pricing', 'codes.manage',
    'orders.read', 'orders.retry', 'orders.fulfil_manual', 'orders.cancel',
    'payments.read', 'payments.refund',
    'providers.read', 'providers.write',
    'coupons.manage', 'banners.manage', 'notifications.send',
    'reports.read', 'reports.export', 'audit.read',
  ],
  support: [
    'users.read', 'catalog.read',
    'orders.read', 'orders.retry',
    'payments.read', 'notifications.send',
  ],
  finance: [
    'orders.read', 'payments.read', 'payments.refund', 'wallet.adjust',
    'providers.read', 'reports.read', 'reports.export',
  ],
  customer: [],
};

// ═══════════════ Seed ═══════════════

async function main() {
  console.log('→ currencies');
  const currencies = [
    { code: 'USD', nameAr: 'دولار أمريكي', nameEn: 'US Dollar',   symbol: '$',   decimals: 2, isBase: true,  sortOrder: 1 },
    { code: 'EUR', nameAr: 'يورو',         nameEn: 'Euro',        symbol: '€',   decimals: 2, isBase: false, sortOrder: 2 },
    { code: 'MRU', nameAr: 'أوقية موريتانية', nameEn: 'Mauritanian Ouguiya', symbol: 'UM', decimals: 2, isBase: false, sortOrder: 3 },
    // XOF has no minor unit — never display or charge fractions
    { code: 'XOF', nameAr: 'فرنك غرب أفريقي', nameEn: 'West African CFA Franc', symbol: 'CFA', decimals: 0, isBase: false, sortOrder: 4, roundingStep: new Prisma.Decimal(5) },
  ];
  for (const c of currencies) {
    await prisma.currency.upsert({ where: { code: c.code }, update: c as any, create: c as any });
  }

  console.log('→ fx rates (seed values — replace with a live feed before launch)');
  const RATES: Array<[string, number]> = [
    ['EUR', 0.92],
    ['MRU', 39.8],
    ['XOF', 604.0],
  ];
  for (const [quote, rate] of RATES) {
    const existing = await prisma.fxRate.findFirst({
      where: { baseCurrency: 'USD', quoteCurrency: quote, isActive: true },
      orderBy: { effectiveAt: 'desc' },
    });
    if (!existing) {
      await prisma.fxRate.create({
        data: { baseCurrency: 'USD', quoteCurrency: quote, rate: new Prisma.Decimal(rate), source: 'MANUAL' },
      });
    }
  }

  console.log('→ permissions');
  for (const [key, module, description] of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key },
      update: { module, description },
      create: { key, module, description },
    });
  }
  const allPermissions = await prisma.permission.findMany();

  console.log('→ roles');
  for (const [name, keys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, isSystem: true, description: `${name} role` },
    });
    const granted = keys === '*' ? allPermissions : allPermissions.filter((p) => keys.includes(p.key));
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: granted.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
  }

  console.log('→ super admin');
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error('SEED_ADMIN_PASSWORD is required');
  const superAdminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'super_admin' } });
  const admin = await prisma.user.upsert({
    where: { email: process.env.SEED_ADMIN_EMAIL ?? 'admin@patron.io' },
    update: {},
    create: {
      email: process.env.SEED_ADMIN_EMAIL ?? 'admin@patron.io',
      fullName: 'Patron Super Admin',
      passwordHash: await argon2Hash(adminPassword),
      emailVerifiedAt: new Date(),
      locale: 'ar',
    },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superAdminRole.id } },
    update: {},
    create: { userId: admin.id, roleId: superAdminRole.id },
  });

  console.log('→ categories');
  const categories = [
    { slug: 'games', nameAr: 'الألعاب', nameEn: 'Games', sortOrder: 1 },
    { slug: 'gift-cards', nameAr: 'بطاقات الهدايا', nameEn: 'Gift Cards', sortOrder: 2 },
    { slug: 'subscriptions', nameAr: 'الاشتراكات', nameEn: 'Subscriptions', sortOrder: 3 },
    { slug: 'software', nameAr: 'البرامج والتراخيص', nameEn: 'Software & Licenses', sortOrder: 4 },
  ];
  const cat: Record<string, string> = {};
  for (const c of categories) {
    const row = await prisma.category.upsert({ where: { slug: c.slug }, update: c, create: c });
    cat[c.slug] = row.id;
  }

  console.log('→ games');
  const pubgInputs = [
    { key: 'player_id', labelAr: 'معرّف اللاعب', labelEn: 'Player ID', type: 'text', required: true, regex: '^[0-9]{8,12}$', sensitive: false },
  ];
  const mlbbInputs = [
    { key: 'user_id', labelAr: 'معرّف المستخدم', labelEn: 'User ID', type: 'text', required: true, regex: '^[0-9]{6,12}$', sensitive: false },
    { key: 'zone_id', labelAr: 'معرّف السيرفر', labelEn: 'Zone ID', type: 'text', required: true, regex: '^[0-9]{3,6}$', sensitive: false },
  ];
  const games = [
    { slug: 'pubg-mobile', nameAr: 'ببجي موبايل', nameEn: 'PUBG Mobile', categoryId: cat['games'], inputSchema: pubgInputs, isFeatured: true, sortOrder: 1 },
    { slug: 'mobile-legends', nameAr: 'موبايل ليجندز', nameEn: 'Mobile Legends', categoryId: cat['games'], inputSchema: mlbbInputs, isFeatured: true, sortOrder: 2 },
    { slug: 'free-fire', nameAr: 'فري فاير', nameEn: 'Free Fire', categoryId: cat['games'], inputSchema: pubgInputs, sortOrder: 3 },
  ];
  const game: Record<string, string> = {};
  for (const g of games) {
    const row = await prisma.game.upsert({ where: { slug: g.slug }, update: g as any, create: g as any });
    game[g.slug] = row.id;
  }

  console.log('→ products');
  const products = [
    { sku: 'PUBG-UC-60',  type: ProductType.GAME_TOPUP, delivery: DeliveryMode.AUTO_PROVIDER, nameAr: '60 شدة ببجي',  nameEn: 'PUBG 60 UC',  currency: 'USD', costPrice: 3.20,  sellPrice: 4.00,  categoryId: cat['games'], gameId: game['pubg-mobile'], sortOrder: 1, isFeatured: true },
    { sku: 'PUBG-UC-325', type: ProductType.GAME_TOPUP, delivery: DeliveryMode.AUTO_PROVIDER, nameAr: '325 شدة ببجي', nameEn: 'PUBG 325 UC', currency: 'USD', costPrice: 15.50, sellPrice: 19.00, categoryId: cat['games'], gameId: game['pubg-mobile'], sortOrder: 2 },
    { sku: 'MLBB-DIA-86', type: ProductType.GAME_TOPUP, delivery: DeliveryMode.AUTO_PROVIDER, nameAr: '86 جوهرة ML',  nameEn: 'MLBB 86 Diamonds', currency: 'USD', costPrice: 4.10, sellPrice: 5.25, categoryId: cat['games'], gameId: game['mobile-legends'], sortOrder: 1 },
    { sku: 'GC-ITUNES-50', type: ProductType.GIFT_CARD, delivery: DeliveryMode.CODE_POOL, nameAr: 'بطاقة آيتونز 50$', nameEn: 'iTunes Gift Card $50', currency: 'USD', costPrice: 46.00, sellPrice: 52.00, categoryId: cat['gift-cards'], stockQty: 0, sortOrder: 1, isFeatured: true, metadata: { region: 'GLOBAL' } },
    { sku: 'GC-PSN-100',   type: ProductType.GIFT_CARD, delivery: DeliveryMode.CODE_POOL, nameAr: 'بطاقة بلايستيشن 100$', nameEn: 'PSN Card $100', currency: 'USD', costPrice: 93.00, sellPrice: 105.00, categoryId: cat['gift-cards'], stockQty: 0, sortOrder: 2, metadata: { region: 'GLOBAL' } },
    { sku: 'SUB-NETFLIX-1M', type: ProductType.SUBSCRIPTION, delivery: DeliveryMode.MANUAL, nameAr: 'نتفلكس شهر', nameEn: 'Netflix 1 Month', currency: 'USD', costPrice: 30.00, sellPrice: 39.00, categoryId: cat['subscriptions'], sortOrder: 1, metadata: { durationDays: 30 } },
    { sku: 'LIC-WIN11-PRO', type: ProductType.LICENSE, delivery: DeliveryMode.CODE_POOL, nameAr: 'ترخيص ويندوز 11 برو', nameEn: 'Windows 11 Pro License', currency: 'USD', costPrice: 22.00, sellPrice: 45.00, categoryId: cat['software'], stockQty: 0, sortOrder: 1, metadata: { licenseTerm: 'lifetime', platform: 'windows' } },
  ];
  const prod: Record<string, string> = {};
  for (const p of products) {
    const row = await prisma.product.upsert({ where: { sku: p.sku }, update: p as any, create: p as any });
    prod[p.sku] = row.id;
  }


  console.log('→ manual price overrides (XOF is rounded, not converted)');
  const overrides = [
    { sku: 'PUBG-UC-60',  currencyCode: 'XOF', sellPrice: 2500 },
    { sku: 'PUBG-UC-325', currencyCode: 'XOF', sellPrice: 11500 },
    { sku: 'PUBG-UC-60',  currencyCode: 'MRU', sellPrice: 160 },
  ];
  for (const o of overrides) {
    await prisma.productPrice.upsert({
      where: { productId_currencyCode: { productId: prod[o.sku], currencyCode: o.currencyCode } },
      update: { sellPrice: o.sellPrice },
      create: { productId: prod[o.sku], currencyCode: o.currencyCode, sellPrice: o.sellPrice },
    });
  }

  console.log('→ providers');
  const providers = [
    {
      code: 'fazercards',
      name: 'FazerCards',
      baseUrl: process.env.FAZERCARDS_BASE_URL ?? 'https://api.fazercards.com/v1',
      apiKeyEnc: encrypt(process.env.FAZERCARDS_API_KEY ?? 'REPLACE_ME'),
      priority: 0,
      timeoutMs: 20000,
      maxRetries: 2,
      lowBalanceAlert: 500,
    },
    {
      code: 'foxreload',
      name: 'FoxReload',
      baseUrl: process.env.FOXRELOAD_BASE_URL ?? 'https://api.foxreload.com/v2',
      apiKeyEnc: encrypt(process.env.FOXRELOAD_API_KEY ?? 'REPLACE_ME'),
      priority: 1,
      timeoutMs: 25000,
      maxRetries: 2,
      lowBalanceAlert: 500,
    },
  ];
  const prov: Record<string, string> = {};
  for (const p of providers) {
    const row = await prisma.provider.upsert({ where: { code: p.code }, update: { name: p.name, baseUrl: p.baseUrl, priority: p.priority }, create: p });
    prov[p.code] = row.id;
  }

  console.log('→ product ↔ provider mapping');
  const mappings = [
    { sku: 'PUBG-UC-60',  provider: 'fazercards', providerSku: 'PUBGM_UC_60',  providerCost: 3.20, priority: 0 },
    { sku: 'PUBG-UC-60',  provider: 'foxreload',  providerSku: 'pubg-uc-60',   providerCost: 3.35, priority: 1 },
    { sku: 'PUBG-UC-325', provider: 'fazercards', providerSku: 'PUBGM_UC_325', providerCost: 15.50, priority: 0 },
    { sku: 'PUBG-UC-325', provider: 'foxreload',  providerSku: 'pubg-uc-325',  providerCost: 15.80, priority: 1 },
    { sku: 'MLBB-DIA-86', provider: 'foxreload',  providerSku: 'mlbb-dia-86',  providerCost: 4.10, priority: 0 },
  ];
  for (const m of mappings) {
    await prisma.productProvider.upsert({
      where: { productId_providerId: { productId: prod[m.sku], providerId: prov[m.provider] } },
      update: { providerSku: m.providerSku, providerCost: m.providerCost, priority: m.priority },
      create: { productId: prod[m.sku], providerId: prov[m.provider], providerSku: m.providerSku, providerCost: m.providerCost, priority: m.priority },
    });
  }

  console.log('→ coupons');
  await prisma.coupon.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: {
      code: 'WELCOME10',
      discountType: DiscountType.PERCENT,
      discountValue: 10,
      maxDiscount: 20,
      minOrderTotal: 25,
      maxUsesPerUser: 1,
      expiresAt: new Date(Date.now() + 90 * 864e5),
    },
  });

  console.log('→ notification templates');
  const templates = [
    {
      key: 'order.paid',
      channels: ['IN_APP', 'EMAIL'],
      titleAr: 'تم استلام دفعتك', titleEn: 'Payment received',
      bodyAr: 'استلمنا دفعة طلبك {{orderNumber}} بقيمة {{total}} {{currency}}. جاري التنفيذ.',
      bodyEn: 'We received payment for order {{orderNumber}} ({{total}} {{currency}}). Fulfilment is underway.',
    },
    {
      key: 'order.completed',
      channels: ['IN_APP', 'EMAIL', 'PUSH'],
      titleAr: 'اكتمل طلبك', titleEn: 'Your order is ready',
      bodyAr: 'طلبك {{orderNumber}} جاهز. افتح التطبيق لعرض التفاصيل.',
      bodyEn: 'Order {{orderNumber}} is ready. Open the app to view it.',
    },
    {
      key: 'order.partially_completed',
      channels: ['IN_APP', 'EMAIL'],
      titleAr: 'اكتمل طلبك جزئياً', titleEn: 'Your order is partly complete',
      bodyAr: 'تم تسليم جزء من طلب {{orderNumber}}. فريق الدعم يتابع الباقي.',
      bodyEn: 'Part of order {{orderNumber}} was delivered. Support is following up on the rest.',
    },
    {
      key: 'order.failed',
      channels: ['IN_APP', 'EMAIL'],
      titleAr: 'تعذر تنفيذ طلبك', titleEn: 'We could not complete your order',
      bodyAr: 'لم نتمكن من تنفيذ طلب {{orderNumber}}. سيتم رد المبلغ خلال أيام عمل قليلة.',
      bodyEn: 'We could not fulfil order {{orderNumber}}. A refund will be issued within a few business days.',
    },
    {
      key: 'refund.processed',
      channels: ['IN_APP', 'EMAIL'],
      titleAr: 'تمت معالجة الاسترداد', titleEn: 'Refund processed',
      bodyAr: 'تمت معالجة استرداد طلب {{orderNumber}}.',
      bodyEn: 'Your refund for order {{orderNumber}} has been processed.',
    },
  ];
  for (const t of templates) {
    await prisma.notificationTemplate.upsert({ where: { key: t.key }, update: t as any, create: t as any });
  }

  console.log('→ settings');
  const settings = [
    { key: 'platform.name', value: 'Patron', group: 'general', isPublic: true },
    { key: 'platform.base_currency', value: 'USD', group: 'currency', isPublic: true },
    { key: 'platform.enabled_currencies', value: ['USD', 'EUR', 'MRU', 'XOF'], group: 'currency', isPublic: true },
    { key: 'currency.fx_markup_percent', value: 2.5, group: 'currency', description: 'Margin added on top of the raw FX rate at checkout' },
    { key: 'currency.fx_refresh_minutes', value: 60, group: 'currency' },
    { key: 'tax.enabled', value: false, group: 'tax', description: 'MVP: off. Turning this on activates the taxAmount columns.' },
    { key: 'tax.default_rate', value: 0, group: 'tax' },
    { key: 'platform.default_locale', value: 'ar', group: 'general', isPublic: true },
    { key: 'platform.maintenance_mode', value: false, group: 'general', isPublic: true },
    { key: 'orders.max_open_per_user', value: 5, group: 'orders' },
    { key: 'orders.auto_cancel_minutes', value: 30, group: 'orders', description: 'Unpaid orders auto-cancel after N minutes' },
    { key: 'orders.fulfilment_max_retries', value: 3, group: 'orders' },
    { key: 'payments.enabled_gateways', value: ['WALLET', 'STRIPE'], group: 'payments', isPublic: true },
    { key: 'security.otp_ttl_seconds', value: 300, group: 'security' },
    { key: 'security.max_login_attempts', value: 5, group: 'security' },
    { key: 'security.lockout_minutes', value: 15, group: 'security' },
  ];
  for (const s of settings) {
    await prisma.systemSetting.upsert({
      where: { key: s.key },
      update: { value: s.value as any, group: s.group, isPublic: s.isPublic ?? false },
      create: { key: s.key, value: s.value as any, group: s.group, isPublic: s.isPublic ?? false, description: s.description },
    });
  }

  console.log('✓ seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
