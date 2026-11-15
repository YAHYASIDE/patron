/* eslint-disable no-console */
/**
 * Patron starter catalog ("catalog pack"), applied ONCE to a live database.
 *
 * Unlike the seed (upserts that overwrite), this is insert-only: a category,
 * game or product is created only when its slug/SKU does not exist yet, and an
 * existing row is never modified. Rows the owner later edits or deletes from
 * the dashboard stay exactly as they left them (a soft-deleted product still
 * owns its SKU, so it is never re-added).
 *
 * Packs are versioned (`catalog.pack.v1`, `catalog.pack.v2`, ...): each one
 * records a SystemSetting marker when it finishes, so later boots skip it, and
 * a new pack ships as a new key, never as an edit to an applied one. If a run
 * is interrupted, the next boot finishes it: every step is idempotent. The one
 * kind of update a pack makes is filling a field the owner left empty (product
 * art where imageUrl is null) or re-filing rows still where the pack put them.
 *
 * Run by the Docker entrypoint when CATALOG_PACK=true (dist/catalog-pack-runner.js).
 *
 * Prices are a starting point chosen for the owner to review (USD, the base
 * currency): sellPrice is what customers pay, costPrice an estimated supplier
 * cost. Every product is MANUAL delivery, the only mode that fulfils end to end
 * today (no code-upload route or live provider yet).
 *
 * "Games" double as the input-form carrier the checkout uses (player ID,
 * username, email), so apps that need an account identifier get one too.
 */
import { PrismaClient, ProductType, DeliveryMode, Prisma } from '@prisma/client';
import { GUIDES } from './catalog-guides';

export const CATALOG_PACK_KEY = 'catalog.pack.v1';
export const CATALOG_PACK_V2_KEY = 'catalog.pack.v2';
export const CATALOG_PACK_V3_KEY = 'catalog.pack.v3';
export const CATALOG_PACK_V4_KEY = 'catalog.pack.v4';
export const CATALOG_PACK_V5_KEY = 'catalog.pack.v5';
export const CATALOG_PACK_V6_KEY = 'catalog.pack.v6';

type Input = {
  key: string;
  labelAr: string;
  labelEn: string;
  type: string;
  required: boolean;
  regex?: string;
  sensitive: boolean;
  helpAr?: string;
  helpFr?: string;
  helpEn?: string;
  options?: Array<{ value: string; labelAr: string; labelEn: string }>;
};

const playerId = (regex = '^[0-9]{6,20}$'): Input[] => [
  { key: 'player_id', labelAr: 'معرّف اللاعب (ID)', labelEn: 'Player ID', type: 'text', required: true, regex, sensitive: false },
];
const username = (labelAr: string, labelEn: string, regex?: string): Input[] => [
  { key: 'username', labelAr, labelEn, type: 'text', required: true, regex, sensitive: false },
];
const accountEmail: Input[] = [
  { key: 'email', labelAr: 'البريد الإلكتروني للحساب', labelEn: 'Account email', type: 'email', required: true, regex: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$', sensitive: false },
];

const CATEGORIES = [
  { slug: 'games', nameAr: 'الألعاب', nameEn: 'Games', sortOrder: 1 },
  { slug: 'gift-cards', nameAr: 'بطاقات الهدايا', nameEn: 'Gift Cards', sortOrder: 2 },
  { slug: 'subscriptions', nameAr: 'الاشتراكات', nameEn: 'Subscriptions', sortOrder: 3 },
  { slug: 'software', nameAr: 'البرامج والتراخيص', nameEn: 'Software & Licenses', sortOrder: 4 },
  { slug: 'apps-topup', nameAr: 'شحن التطبيقات', nameEn: 'App Top-ups', sortOrder: 5 },
];

const GAMES: Array<{ slug: string; nameAr: string; nameEn: string; category: string; publisher?: string; inputSchema: Input[]; isFeatured?: boolean; sortOrder: number }> = [
  { slug: 'pubg-mobile', nameAr: 'ببجي موبايل', nameEn: 'PUBG Mobile', category: 'games', publisher: 'Tencent', inputSchema: playerId('^[0-9]{8,12}$'), isFeatured: true, sortOrder: 1 },
  { slug: 'free-fire', nameAr: 'فري فاير', nameEn: 'Free Fire', category: 'games', publisher: 'Garena', inputSchema: playerId('^[0-9]{8,12}$'), isFeatured: true, sortOrder: 2 },
  {
    slug: 'mobile-legends', nameAr: 'موبايل ليجندز', nameEn: 'Mobile Legends', category: 'games', publisher: 'Moonton', sortOrder: 3,
    inputSchema: [
      { key: 'user_id', labelAr: 'معرّف المستخدم', labelEn: 'User ID', type: 'text', required: true, regex: '^[0-9]{6,12}$', sensitive: false },
      { key: 'zone_id', labelAr: 'معرّف السيرفر', labelEn: 'Zone ID', type: 'text', required: true, regex: '^[0-9]{3,6}$', sensitive: false },
    ],
  },
  { slug: 'cod-mobile', nameAr: 'كول أوف ديوتي موبايل', nameEn: 'Call of Duty: Mobile', category: 'games', publisher: 'Activision', inputSchema: playerId(), sortOrder: 4 },
  {
    slug: 'genshin-impact', nameAr: 'جنشن إمباكت', nameEn: 'Genshin Impact', category: 'games', publisher: 'HoYoverse', sortOrder: 5,
    inputSchema: [
      { key: 'uid', labelAr: 'رقم الحساب (UID)', labelEn: 'UID', type: 'text', required: true, regex: '^[0-9]{9,10}$', sensitive: false },
      { key: 'server', labelAr: 'السيرفر (Asia / Europe / America / TW-HK-MO)', labelEn: 'Server', type: 'text', required: true, sensitive: false },
    ],
  },
  { slug: 'yalla-ludo', nameAr: 'يلا لودو', nameEn: 'Yalla Ludo', category: 'games', publisher: 'Yalla', inputSchema: playerId('^[0-9]{4,12}$'), sortOrder: 6 },
  { slug: 'jawaker', nameAr: 'جواكر', nameEn: 'Jawaker', category: 'games', publisher: 'Jawaker', inputSchema: username('معرّف جواكر', 'Jawaker ID'), sortOrder: 7 },
  { slug: 'tiktok', nameAr: 'تيك توك', nameEn: 'TikTok', category: 'apps-topup', inputSchema: username('اسم المستخدم في تيك توك', 'TikTok username', '^@?[A-Za-z0-9._]{2,24}$'), isFeatured: true, sortOrder: 1 },
  { slug: 'bigo-live', nameAr: 'بيجو لايف', nameEn: 'Bigo Live', category: 'apps-topup', inputSchema: username('معرّف بيجو', 'Bigo ID'), sortOrder: 2 },
  { slug: 'snapchat', nameAr: 'سناب شات', nameEn: 'Snapchat', category: 'subscriptions', inputSchema: username('اسم المستخدم في سناب', 'Snapchat username', '^[A-Za-z][A-Za-z0-9._-]{2,14}$'), sortOrder: 1 },
  { slug: 'telegram', nameAr: 'تيليجرام', nameEn: 'Telegram', category: 'subscriptions', inputSchema: username('اسم المستخدم في تيليجرام', 'Telegram username', '^@?[A-Za-z][A-Za-z0-9_]{4,31}$'), sortOrder: 2 },
  { slug: 'chatgpt', nameAr: 'شات جي بي تي', nameEn: 'ChatGPT', category: 'subscriptions', inputSchema: accountEmail, sortOrder: 3 },
  { slug: 'canva', nameAr: 'كانفا', nameEn: 'Canva', category: 'subscriptions', inputSchema: accountEmail, sortOrder: 4 },
];

type P = {
  sku: string;
  type: ProductType;
  nameAr: string;
  nameEn: string;
  category: string;
  game?: string;
  sell: number;
  cost: number;
  description: string;
  isFeatured?: boolean;
  metadata?: Record<string, unknown>;
};

const TOPUP = 'يُشحن على حسابك مباشرة بعد إدخال معرّفك. لا نطلب كلمة المرور أبدًا.';
const appTopup = (app: string) => `يُضاف الرصيد إلى حسابك في ${app} بعد إدخال اسم المستخدم. لا نطلب كلمة المرور أبدًا.`;
const card = (region: string) => `كود رقمي يصلك بعد الدفع، تفعّله بنفسك. صالح لحسابات ${region}.`;
const sub = (months: number) =>
  months === 1 ? 'اشتراك لمدّة شهر واحد. تصلك تفاصيل التفعيل بعد الدفع.' : `اشتراك لمدّة ${months} أشهر. تصلك تفاصيل التفعيل بعد الدفع.`;
const year = 'اشتراك لمدّة سنة كاملة. تصلك تفاصيل التفعيل بعد الدفع.';

const G = ProductType.GAME_TOPUP;
const C = ProductType.GIFT_CARD;
const S = ProductType.SUBSCRIPTION;
const L = ProductType.LICENSE;

const PRODUCTS: P[] = [
  // ── Game top-ups ──
  { sku: 'TOP-PUBG-60', type: G, game: 'pubg-mobile', category: 'games', nameAr: 'ببجي موبايل 60 شدة', nameEn: 'PUBG Mobile 60 UC', sell: 1.1, cost: 0.92, description: TOPUP },
  { sku: 'TOP-PUBG-325', type: G, game: 'pubg-mobile', category: 'games', nameAr: 'ببجي موبايل 325 شدة', nameEn: 'PUBG Mobile 325 UC', sell: 5.25, cost: 4.6, description: TOPUP },
  { sku: 'TOP-PUBG-660', type: G, game: 'pubg-mobile', category: 'games', nameAr: 'ببجي موبايل 660 شدة', nameEn: 'PUBG Mobile 660 UC', sell: 10.25, cost: 9.2, description: TOPUP, isFeatured: true },
  { sku: 'TOP-PUBG-1800', type: G, game: 'pubg-mobile', category: 'games', nameAr: 'ببجي موبايل 1800 شدة', nameEn: 'PUBG Mobile 1800 UC', sell: 25.5, cost: 23, description: TOPUP },
  { sku: 'TOP-FF-100', type: G, game: 'free-fire', category: 'games', nameAr: 'فري فاير 100 جوهرة', nameEn: 'Free Fire 100 Diamonds', sell: 1.05, cost: 0.9, description: TOPUP },
  { sku: 'TOP-FF-310', type: G, game: 'free-fire', category: 'games', nameAr: 'فري فاير 310 جوهرة', nameEn: 'Free Fire 310 Diamonds', sell: 3.1, cost: 2.75, description: TOPUP },
  { sku: 'TOP-FF-520', type: G, game: 'free-fire', category: 'games', nameAr: 'فري فاير 520 جوهرة', nameEn: 'Free Fire 520 Diamonds', sell: 5.1, cost: 4.5, description: TOPUP, isFeatured: true },
  { sku: 'TOP-FF-1060', type: G, game: 'free-fire', category: 'games', nameAr: 'فري فاير 1060 جوهرة', nameEn: 'Free Fire 1060 Diamonds', sell: 10.2, cost: 9.1, description: TOPUP },
  { sku: 'TOP-MLBB-86', type: G, game: 'mobile-legends', category: 'games', nameAr: 'موبايل ليجندز 86 جوهرة', nameEn: 'Mobile Legends 86 Diamonds', sell: 1.6, cost: 1.4, description: TOPUP },
  { sku: 'TOP-MLBB-172', type: G, game: 'mobile-legends', category: 'games', nameAr: 'موبايل ليجندز 172 جوهرة', nameEn: 'Mobile Legends 172 Diamonds', sell: 3.15, cost: 2.8, description: TOPUP },
  { sku: 'TOP-MLBB-257', type: G, game: 'mobile-legends', category: 'games', nameAr: 'موبايل ليجندز 257 جوهرة', nameEn: 'Mobile Legends 257 Diamonds', sell: 4.7, cost: 4.2, description: TOPUP },
  { sku: 'TOP-MLBB-706', type: G, game: 'mobile-legends', category: 'games', nameAr: 'موبايل ليجندز 706 جوهرة', nameEn: 'Mobile Legends 706 Diamonds', sell: 12.5, cost: 11.2, description: TOPUP },
  { sku: 'TOP-CODM-80', type: G, game: 'cod-mobile', category: 'games', nameAr: 'كول أوف ديوتي موبايل 80 نقطة CP', nameEn: 'COD Mobile 80 CP', sell: 1.1, cost: 0.92, description: TOPUP },
  { sku: 'TOP-CODM-400', type: G, game: 'cod-mobile', category: 'games', nameAr: 'كول أوف ديوتي موبايل 400 نقطة CP', nameEn: 'COD Mobile 400 CP', sell: 5.25, cost: 4.6, description: TOPUP },
  { sku: 'TOP-CODM-800', type: G, game: 'cod-mobile', category: 'games', nameAr: 'كول أوف ديوتي موبايل 800 نقطة CP', nameEn: 'COD Mobile 800 CP', sell: 10.3, cost: 9.2, description: TOPUP },
  { sku: 'TOP-GENSHIN-60', type: G, game: 'genshin-impact', category: 'games', nameAr: 'جنشن إمباكت 60 كريستالة', nameEn: 'Genshin Impact 60 Genesis Crystals', sell: 1.1, cost: 0.93, description: TOPUP },
  { sku: 'TOP-GENSHIN-330', type: G, game: 'genshin-impact', category: 'games', nameAr: 'جنشن إمباكت 330 كريستالة', nameEn: 'Genshin Impact 300+30 Genesis Crystals', sell: 5.3, cost: 4.7, description: TOPUP },
  { sku: 'TOP-GENSHIN-1090', type: G, game: 'genshin-impact', category: 'games', nameAr: 'جنشن إمباكت 1090 كريستالة', nameEn: 'Genshin Impact 980+110 Genesis Crystals', sell: 15.5, cost: 13.9, description: TOPUP },
  { sku: 'TOP-GENSHIN-WELKIN', type: G, game: 'genshin-impact', category: 'games', nameAr: 'جنشن إمباكت بركة القمر (Welkin)', nameEn: 'Genshin Impact Blessing of the Welkin Moon', sell: 5.3, cost: 4.7, description: TOPUP },
  { sku: 'TOP-YALLA-5', type: G, game: 'yalla-ludo', category: 'games', nameAr: 'يلا لودو شحن بقيمة 5$', nameEn: 'Yalla Ludo top-up $5', sell: 5.4, cost: 4.8, description: TOPUP },
  { sku: 'TOP-YALLA-10', type: G, game: 'yalla-ludo', category: 'games', nameAr: 'يلا لودو شحن بقيمة 10$', nameEn: 'Yalla Ludo top-up $10', sell: 10.6, cost: 9.5, description: TOPUP },
  { sku: 'TOP-JAWAKER-5', type: G, game: 'jawaker', category: 'games', nameAr: 'جواكر توكنز بقيمة 5$', nameEn: 'Jawaker tokens $5', sell: 5.4, cost: 4.8, description: TOPUP },
  { sku: 'TOP-JAWAKER-10', type: G, game: 'jawaker', category: 'games', nameAr: 'جواكر توكنز بقيمة 10$', nameEn: 'Jawaker tokens $10', sell: 10.6, cost: 9.5, description: TOPUP },

  // ── App top-ups ──
  { sku: 'APP-TIKTOK-70', type: G, game: 'tiktok', category: 'apps-topup', nameAr: 'تيك توك 70 عملة', nameEn: 'TikTok 70 Coins', sell: 1.15, cost: 0.95, description: appTopup('تيك توك') },
  { sku: 'APP-TIKTOK-350', type: G, game: 'tiktok', category: 'apps-topup', nameAr: 'تيك توك 350 عملة', nameEn: 'TikTok 350 Coins', sell: 5.4, cost: 4.8, description: appTopup('تيك توك') },
  { sku: 'APP-TIKTOK-700', type: G, game: 'tiktok', category: 'apps-topup', nameAr: 'تيك توك 700 عملة', nameEn: 'TikTok 700 Coins', sell: 10.6, cost: 9.5, description: appTopup('تيك توك'), isFeatured: true },
  { sku: 'APP-TIKTOK-1400', type: G, game: 'tiktok', category: 'apps-topup', nameAr: 'تيك توك 1400 عملة', nameEn: 'TikTok 1400 Coins', sell: 21, cost: 19, description: appTopup('تيك توك') },
  { sku: 'APP-BIGO-5', type: G, game: 'bigo-live', category: 'apps-topup', nameAr: 'بيجو لايف ماسات بقيمة 5$', nameEn: 'Bigo Live diamonds $5', sell: 5.4, cost: 4.8, description: appTopup('بيجو لايف') },
  { sku: 'APP-BIGO-10', type: G, game: 'bigo-live', category: 'apps-topup', nameAr: 'بيجو لايف ماسات بقيمة 10$', nameEn: 'Bigo Live diamonds $10', sell: 10.6, cost: 9.5, description: appTopup('بيجو لايف') },

  // ── Gift cards ──
  { sku: 'GC-APPLE-US-10', type: C, category: 'gift-cards', nameAr: 'بطاقة آيتونز / آبل 10$', nameEn: 'Apple Gift Card $10 (US)', sell: 10.9, cost: 9.8, description: card('آبل الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-APPLE-US-25', type: C, category: 'gift-cards', nameAr: 'بطاقة آيتونز / آبل 25$', nameEn: 'Apple Gift Card $25 (US)', sell: 26.9, cost: 24.5, description: card('آبل الأمريكية (US)'), metadata: { region: 'US' }, isFeatured: true },
  { sku: 'GC-APPLE-US-50', type: C, category: 'gift-cards', nameAr: 'بطاقة آيتونز / آبل 50$', nameEn: 'Apple Gift Card $50 (US)', sell: 53.5, cost: 49, description: card('آبل الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-APPLE-US-100', type: C, category: 'gift-cards', nameAr: 'بطاقة آيتونز / آبل 100$', nameEn: 'Apple Gift Card $100 (US)', sell: 106, cost: 98, description: card('آبل الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-GPLAY-US-10', type: C, category: 'gift-cards', nameAr: 'بطاقة جوجل بلاي 10$', nameEn: 'Google Play $10 (US)', sell: 10.9, cost: 9.7, description: card('جوجل بلاي الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-GPLAY-US-25', type: C, category: 'gift-cards', nameAr: 'بطاقة جوجل بلاي 25$', nameEn: 'Google Play $25 (US)', sell: 26.8, cost: 24.3, description: card('جوجل بلاي الأمريكية (US)'), metadata: { region: 'US' }, isFeatured: true },
  { sku: 'GC-GPLAY-US-50', type: C, category: 'gift-cards', nameAr: 'بطاقة جوجل بلاي 50$', nameEn: 'Google Play $50 (US)', sell: 53, cost: 48.5, description: card('جوجل بلاي الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-PSN-US-10', type: C, category: 'gift-cards', nameAr: 'بطاقة بلايستيشن 10$', nameEn: 'PlayStation Store $10 (US)', sell: 10.9, cost: 9.8, description: card('بلايستيشن الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-PSN-US-25', type: C, category: 'gift-cards', nameAr: 'بطاقة بلايستيشن 25$', nameEn: 'PlayStation Store $25 (US)', sell: 26.9, cost: 24.6, description: card('بلايستيشن الأمريكية (US)'), metadata: { region: 'US' }, isFeatured: true },
  { sku: 'GC-PSN-US-50', type: C, category: 'gift-cards', nameAr: 'بطاقة بلايستيشن 50$', nameEn: 'PlayStation Store $50 (US)', sell: 53.5, cost: 49, description: card('بلايستيشن الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-XBOX-US-15', type: C, category: 'gift-cards', nameAr: 'بطاقة إكس بوكس 15$', nameEn: 'Xbox Gift Card $15 (US)', sell: 16.3, cost: 14.6, description: card('إكس بوكس الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-XBOX-US-25', type: C, category: 'gift-cards', nameAr: 'بطاقة إكس بوكس 25$', nameEn: 'Xbox Gift Card $25 (US)', sell: 26.9, cost: 24.5, description: card('إكس بوكس الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-STEAM-20', type: C, category: 'gift-cards', nameAr: 'بطاقة ستيم 20$', nameEn: 'Steam Wallet $20', sell: 21.6, cost: 19.6, description: card('ستيم بالدولار'), metadata: { region: 'USD' } },
  { sku: 'GC-STEAM-50', type: C, category: 'gift-cards', nameAr: 'بطاقة ستيم 50$', nameEn: 'Steam Wallet $50', sell: 53.5, cost: 49, description: card('ستيم بالدولار'), metadata: { region: 'USD' } },
  { sku: 'GC-ROBLOX-10', type: C, category: 'gift-cards', nameAr: 'بطاقة روبلوكس 10$', nameEn: 'Roblox Gift Card $10', sell: 10.9, cost: 9.8, description: card('روبلوكس'), metadata: { region: 'GLOBAL' } },
  { sku: 'GC-ROBLOX-25', type: C, category: 'gift-cards', nameAr: 'بطاقة روبلوكس 25$', nameEn: 'Roblox Gift Card $25', sell: 26.9, cost: 24.5, description: card('روبلوكس'), metadata: { region: 'GLOBAL' } },
  { sku: 'GC-RAZER-10', type: C, category: 'gift-cards', nameAr: 'بطاقة رازر جولد 10$', nameEn: 'Razer Gold $10', sell: 10.6, cost: 9.8, description: card('رازر جولد العالمية'), metadata: { region: 'GLOBAL' } },
  { sku: 'GC-RAZER-25', type: C, category: 'gift-cards', nameAr: 'بطاقة رازر جولد 25$', nameEn: 'Razer Gold $25', sell: 26.3, cost: 24.6, description: card('رازر جولد العالمية'), metadata: { region: 'GLOBAL' } },
  { sku: 'GC-RAZER-50', type: C, category: 'gift-cards', nameAr: 'بطاقة رازر جولد 50$', nameEn: 'Razer Gold $50', sell: 52.3, cost: 49.2, description: card('رازر جولد العالمية'), metadata: { region: 'GLOBAL' } },
  { sku: 'GC-AMAZON-US-25', type: C, category: 'gift-cards', nameAr: 'بطاقة أمازون 25$', nameEn: 'Amazon.com Gift Card $25', sell: 27, cost: 24.6, description: card('أمازون الأمريكية (amazon.com)'), metadata: { region: 'US' } },
  { sku: 'GC-AMAZON-US-50', type: C, category: 'gift-cards', nameAr: 'بطاقة أمازون 50$', nameEn: 'Amazon.com Gift Card $50', sell: 53.5, cost: 49.2, description: card('أمازون الأمريكية (amazon.com)'), metadata: { region: 'US' } },
  { sku: 'GC-FORTNITE-1000', type: C, category: 'gift-cards', nameAr: 'فورتنايت 1000 فيبكس', nameEn: 'Fortnite 1,000 V-Bucks', sell: 9.6, cost: 8.4, description: card('فورتنايت'), metadata: { region: 'GLOBAL' } },
  { sku: 'GC-NINTENDO-US-20', type: C, category: 'gift-cards', nameAr: 'بطاقة نينتندو إي شوب 20$', nameEn: 'Nintendo eShop $20 (US)', sell: 21.6, cost: 19.6, description: card('نينتندو الأمريكية (US)'), metadata: { region: 'US' } },

  // ── Subscriptions ──
  { sku: 'SUB-NFLX-1M', type: S, category: 'subscriptions', nameAr: 'اشتراك نتفلكس شهر', nameEn: 'Netflix 1 Month', sell: 11, cost: 9, description: sub(1), metadata: { durationDays: 30 }, isFeatured: true },
  { sku: 'SUB-SHAHID-1M', type: S, category: 'subscriptions', nameAr: 'شاهد VIP شهر', nameEn: 'Shahid VIP 1 Month', sell: 8, cost: 6.5, description: sub(1), metadata: { durationDays: 30 }, isFeatured: true },
  { sku: 'SUB-SHAHID-3M', type: S, category: 'subscriptions', nameAr: 'شاهد VIP ثلاثة أشهر', nameEn: 'Shahid VIP 3 Months', sell: 21, cost: 18, description: sub(3), metadata: { durationDays: 90 } },
  { sku: 'SUB-OSN-1M', type: S, category: 'subscriptions', nameAr: 'OSN+ شهر', nameEn: 'OSN+ 1 Month', sell: 9, cost: 7.5, description: sub(1), metadata: { durationDays: 30 } },
  { sku: 'SUB-DISNEY-1M', type: S, category: 'subscriptions', nameAr: 'ديزني بلس شهر', nameEn: 'Disney+ 1 Month', sell: 9, cost: 7.5, description: sub(1), metadata: { durationDays: 30 } },
  { sku: 'SUB-YTPREMIUM-1M', type: S, category: 'subscriptions', nameAr: 'يوتيوب بريميوم شهر', nameEn: 'YouTube Premium 1 Month', sell: 8, cost: 6.5, description: sub(1), metadata: { durationDays: 30 } },
  { sku: 'SUB-SPOTIFY-1M', type: S, category: 'subscriptions', nameAr: 'سبوتيفاي بريميوم شهر', nameEn: 'Spotify Premium 1 Month', sell: 6, cost: 4.8, description: sub(1), metadata: { durationDays: 30 } },
  { sku: 'SUB-SPOTIFY-3M', type: S, category: 'subscriptions', nameAr: 'سبوتيفاي بريميوم ثلاثة أشهر', nameEn: 'Spotify Premium 3 Months', sell: 16, cost: 13.5, description: sub(3), metadata: { durationDays: 90 } },
  { sku: 'SUB-SPOTIFY-12M', type: S, category: 'subscriptions', nameAr: 'سبوتيفاي بريميوم سنة', nameEn: 'Spotify Premium 12 Months', sell: 55, cost: 47, description: year, metadata: { durationDays: 365 } },
  { sku: 'SUB-ANGHAMI-1M', type: S, category: 'subscriptions', nameAr: 'أنغامي بلس شهر', nameEn: 'Anghami Plus 1 Month', sell: 5, cost: 4, description: sub(1), metadata: { durationDays: 30 } },
  { sku: 'SUB-ANGHAMI-12M', type: S, category: 'subscriptions', nameAr: 'أنغامي بلس سنة', nameEn: 'Anghami Plus 12 Months', sell: 45, cost: 38, description: year, metadata: { durationDays: 365 } },
  { sku: 'SUB-APPLEMUSIC-1M', type: S, category: 'subscriptions', nameAr: 'آبل ميوزك شهر', nameEn: 'Apple Music 1 Month', sell: 7, cost: 5.8, description: sub(1), metadata: { durationDays: 30 } },
  { sku: 'SUB-SNAPPLUS-1M', type: S, game: 'snapchat', category: 'subscriptions', nameAr: 'سناب شات بلس شهر', nameEn: 'Snapchat+ 1 Month', sell: 4.5, cost: 3.6, description: 'تفعيل سناب شات بلس على حسابك لمدّة شهر بعد إدخال اسم المستخدم.', metadata: { durationDays: 30 } },
  { sku: 'SUB-SNAPPLUS-12M', type: S, game: 'snapchat', category: 'subscriptions', nameAr: 'سناب شات بلس سنة', nameEn: 'Snapchat+ 12 Months', sell: 40, cost: 34, description: 'تفعيل سناب شات بلس على حسابك لمدّة سنة بعد إدخال اسم المستخدم.', metadata: { durationDays: 365 } },
  { sku: 'SUB-TGPREMIUM-3M', type: S, game: 'telegram', category: 'subscriptions', nameAr: 'تيليجرام بريميوم ثلاثة أشهر', nameEn: 'Telegram Premium 3 Months', sell: 14.5, cost: 12.5, description: 'تفعيل تيليجرام بريميوم على حسابك بعد إدخال اسم المستخدم.', metadata: { durationDays: 90 } },
  { sku: 'SUB-TGPREMIUM-12M', type: S, game: 'telegram', category: 'subscriptions', nameAr: 'تيليجرام بريميوم سنة', nameEn: 'Telegram Premium 12 Months', sell: 40, cost: 34, description: 'تفعيل تيليجرام بريميوم على حسابك لمدّة سنة بعد إدخال اسم المستخدم.', metadata: { durationDays: 365 } },
  { sku: 'SUB-CHATGPT-1M', type: S, game: 'chatgpt', category: 'subscriptions', nameAr: 'شات جي بي تي بلس شهر', nameEn: 'ChatGPT Plus 1 Month', sell: 24, cost: 20.5, description: 'تفعيل ChatGPT Plus على حسابك لمدّة شهر. أدخل بريد حسابك.', metadata: { durationDays: 30 }, isFeatured: true },
  { sku: 'SUB-CANVA-12M', type: S, game: 'canva', category: 'subscriptions', nameAr: 'كانفا برو سنة', nameEn: 'Canva Pro 12 Months', sell: 125, cost: 118, description: 'تفعيل كانفا برو على حسابك لمدّة سنة. أدخل بريد حسابك.', metadata: { durationDays: 365 } },
  { sku: 'SUB-DISCORD-NITRO-1M', type: S, category: 'subscriptions', nameAr: 'ديسكورد نيترو شهر', nameEn: 'Discord Nitro 1 Month', sell: 10.9, cost: 9.6, description: sub(1), metadata: { durationDays: 30 } },
  { sku: 'SUB-GAMEPASS-ULT-1M', type: S, category: 'subscriptions', nameAr: 'إكس بوكس جيم باس ألتيميت شهر', nameEn: 'Xbox Game Pass Ultimate 1 Month', sell: 32, cost: 29.5, description: sub(1), metadata: { durationDays: 30 } },
  { sku: 'SUB-PSPLUS-ESS-1M', type: S, category: 'subscriptions', nameAr: 'بلايستيشن بلس إسنشال شهر', nameEn: 'PlayStation Plus Essential 1 Month', sell: 10.9, cost: 9.6, description: sub(1), metadata: { durationDays: 30, region: 'US' } },

  // ── Software ──
  { sku: 'LIC-M365-PERSONAL-12M', type: L, category: 'software', nameAr: 'مايكروسوفت 365 بيرسونال سنة', nameEn: 'Microsoft 365 Personal 12 Months', sell: 105, cost: 96, description: 'اشتراك رسمي لمدّة سنة لشخص واحد: وورد وإكسل وباوربوينت و1 تيرابايت تخزين.', metadata: { licenseTerm: '12 months', seats: 1 } },
  { sku: 'LIC-M365-FAMILY-12M', type: L, category: 'software', nameAr: 'مايكروسوفت 365 فاميلي سنة', nameEn: 'Microsoft 365 Family 12 Months', sell: 135, cost: 124, description: 'اشتراك رسمي لمدّة سنة حتى 6 أشخاص، لكل شخص 1 تيرابايت تخزين.', metadata: { licenseTerm: '12 months', seats: 6 } },
];

// ───────────────────────── pack v2 ─────────────────────────
// Brands the owner asked for that v1 lacked, the sections they described
// (digital wallets, crypto), and product art for every pack SKU.

const CATEGORIES_V2 = [
  { slug: 'digital-wallets', nameAr: 'البطاقات والمحافظ الرقمية', nameEn: 'Digital Wallets', sortOrder: 3, isActive: true },
  // Hidden until the owner decides to sell crypto vouchers (they asked "if you deal in crypto").
  { slug: 'crypto', nameAr: 'العملات الرقمية', nameEn: 'Crypto', sortOrder: 7, isActive: false },
];

const RIOT = 'كود رقمي يصلك بعد الدفع، تفعّله بنفسك. صالح لحسابات رايوت جيمز: تشحن به ليج أوف ليجندز وفالورانت.';

const PRODUCTS_V2: Array<P & { isActive?: boolean }> = [
  { sku: 'GC-NETFLIX-US-25', type: C, category: 'gift-cards', nameAr: 'بطاقة نتفلكس 25$', nameEn: 'Netflix Gift Card $25 (US)', sell: 26.9, cost: 24.6, description: card('نتفلكس الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-NETFLIX-US-50', type: C, category: 'gift-cards', nameAr: 'بطاقة نتفلكس 50$', nameEn: 'Netflix Gift Card $50 (US)', sell: 53.5, cost: 49.2, description: card('نتفلكس الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-SPOTIFY-US-10', type: C, category: 'gift-cards', nameAr: 'بطاقة سبوتيفاي 10$', nameEn: 'Spotify Gift Card $10 (US)', sell: 10.9, cost: 9.7, description: card('سبوتيفاي الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-SPOTIFY-US-30', type: C, category: 'gift-cards', nameAr: 'بطاقة سبوتيفاي 30$', nameEn: 'Spotify Gift Card $30 (US)', sell: 32, cost: 29, description: card('سبوتيفاي الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-RIOT-10', type: C, category: 'gift-cards', nameAr: 'بطاقة رايوت جيمز 10$ (ليج أوف ليجندز وفالورانت)', nameEn: 'Riot Games Gift Card $10 (League of Legends, Valorant)', sell: 10.9, cost: 9.8, description: RIOT, metadata: { region: 'GLOBAL' } },
  { sku: 'GC-RIOT-25', type: C, category: 'gift-cards', nameAr: 'بطاقة رايوت جيمز 25$ (ليج أوف ليجندز وفالورانت)', nameEn: 'Riot Games Gift Card $25 (League of Legends, Valorant)', sell: 26.9, cost: 24.5, description: RIOT, metadata: { region: 'GLOBAL' }, isFeatured: true },
  { sku: 'GC-RIOT-50', type: C, category: 'gift-cards', nameAr: 'بطاقة رايوت جيمز 50$ (ليج أوف ليجندز وفالورانت)', nameEn: 'Riot Games Gift Card $50 (League of Legends, Valorant)', sell: 53.5, cost: 49, description: RIOT, metadata: { region: 'GLOBAL' } },
  { sku: 'GC-BATTLENET-20', type: C, category: 'gift-cards', nameAr: 'بطاقة بليزارد Battle.net 20$', nameEn: 'Blizzard Battle.net $20', sell: 21.6, cost: 19.6, description: card('بليزارد Battle.net'), metadata: { region: 'GLOBAL' } },
  { sku: 'GC-BATTLENET-50', type: C, category: 'gift-cards', nameAr: 'بطاقة بليزارد Battle.net 50$', nameEn: 'Blizzard Battle.net $50', sell: 53.5, cost: 49, description: card('بليزارد Battle.net'), metadata: { region: 'GLOBAL' } },
  { sku: 'GC-MINECRAFT-JAVA-BEDROCK', type: C, category: 'gift-cards', nameAr: 'ماين كرافت: نسخة Java و Bedrock كاملة', nameEn: 'Minecraft: Java & Bedrock Edition', sell: 31.5, cost: 28.5, description: 'كود رسمي للعبة ماين كرافت الكاملة (Java و Bedrock للكمبيوتر)، يصلك بعد الدفع.', metadata: { region: 'GLOBAL', platform: 'pc' } },
  { sku: 'GC-MINECRAFT-1720', type: C, category: 'gift-cards', nameAr: 'ماين كرافت 1720 ماين كوين', nameEn: 'Minecraft 1,720 Minecoins', sell: 10.6, cost: 9.4, description: card('ماين كرافت'), metadata: { region: 'GLOBAL' } },
  { sku: 'GC-TWITCH-US-25', type: C, category: 'gift-cards', nameAr: 'بطاقة تويتش 25$', nameEn: 'Twitch Gift Card $25 (US)', sell: 26.9, cost: 24.5, description: card('تويتش الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-TWITCH-US-50', type: C, category: 'gift-cards', nameAr: 'بطاقة تويتش 50$', nameEn: 'Twitch Gift Card $50 (US)', sell: 53.5, cost: 49, description: card('تويتش الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'SUB-DISCORD-NITRO-12M', type: S, category: 'subscriptions', nameAr: 'ديسكورد نيترو سنة', nameEn: 'Discord Nitro 12 Months', sell: 105, cost: 96, description: year, metadata: { durationDays: 365 } },
  // crypto vouchers: created hidden, like their category
  { sku: 'GC-BINANCE-10', type: C, category: 'crypto', nameAr: 'بطاقة هدايا بينانس 10 USDT', nameEn: 'Binance Gift Card 10 USDT', sell: 10.6, cost: 10, description: 'بطاقة هدايا بينانس بقيمة 10 USDT، تُضاف إلى حسابك في بينانس بعد الدفع.', metadata: { asset: 'USDT' }, isActive: false },
  { sku: 'GC-BINANCE-25', type: C, category: 'crypto', nameAr: 'بطاقة هدايا بينانس 25 USDT', nameEn: 'Binance Gift Card 25 USDT', sell: 26.3, cost: 25, description: 'بطاقة هدايا بينانس بقيمة 25 USDT، تُضاف إلى حسابك في بينانس بعد الدفع.', metadata: { asset: 'USDT' }, isActive: false },
  { sku: 'GC-BINANCE-50', type: C, category: 'crypto', nameAr: 'بطاقة هدايا بينانس 50 USDT', nameEn: 'Binance Gift Card 50 USDT', sell: 52.3, cost: 50, description: 'بطاقة هدايا بينانس بقيمة 50 USDT، تُضاف إلى حسابك في بينانس بعد الدفع.', metadata: { asset: 'USDT' }, isActive: false },
];

/** Razer Gold is a wallet top-up: v2 moves it to the wallets section, but only if the owner has not re-filed it. */
const RAZER_SKUS = ['GC-RAZER-10', 'GC-RAZER-25', 'GC-RAZER-50'];

/** Every pack SKU has generated art at <storefront>/art/<sku lowercase>.svg (apps/storefront/public/art). */
export function artUrl(sku: string): string {
  const base = (process.env.STOREFRONT_URL ?? 'https://etssadagha-store.onrender.com').replace(/\/+$/, '');
  return `${base}/art/${sku.toLowerCase()}.svg`;
}

// ───────────────────────── pack v3 ─────────────────────────
// Mauritania first: mobile airtime for the three operators, priced in ouguiya.

/** Mauritanian mobile numbers: 8 digits starting 2, 3 or 4, optionally after +222. */
const MR_PHONE = '^(\\+?222)?[234][0-9]{7}$';
const mrPhone: Input[] = [
  { key: 'phone', labelAr: 'رقم الهاتف المراد شحنه', labelEn: 'Phone number to top up', type: 'tel', required: true, regex: MR_PHONE, sensitive: false },
];

const CATEGORIES_V3 = [{ slug: 'mobile-topup', nameAr: 'شحن رصيد الهاتف', nameEn: 'Mobile Top-up', sortOrder: 0, isActive: true }];

const OPERATORS = [
  { slug: 'mattel', sku: 'MATTEL', nameAr: 'ماتل', nameEn: 'Mattel', sortOrder: 1 },
  { slug: 'mauritel', sku: 'MAURITEL', nameAr: 'موريتل', nameEn: 'Mauritel', sortOrder: 2 },
  { slug: 'chinguitel', sku: 'CHINGUITEL', nameAr: 'شنقيتل', nameEn: 'Chinguitel', sortOrder: 3 },
];
/** Face values in MRU. The customer pays the face value; cost assumes a ~3% operator discount. */
const AIRTIME_MRU = [100, 200, 500, 1000];
/** Only used to derive the USD base price; the MRU price is fixed by an override. */
const MRU_PER_USD = 39.8;

const PRODUCTS_V3: Array<P & { mru: number }> = OPERATORS.flatMap((op) =>
  AIRTIME_MRU.map((mru) => ({
    sku: `TOP-${op.sku}-${mru}`,
    type: G,
    game: op.slug,
    category: 'mobile-topup',
    nameAr: `رصيد ${op.nameAr} ${mru} أوقية`,
    nameEn: `${op.nameEn} airtime ${mru} MRU`,
    sell: Math.round((mru / MRU_PER_USD) * 100) / 100,
    cost: Math.round(((mru * 0.97) / MRU_PER_USD) * 100) / 100,
    mru,
    description: `يُشحن الرصيد مباشرة على رقم ${op.nameAr} الذي تكتبه، بعد تأكيد الدفع.`,
    isFeatured: mru === 200,
    metadata: { country: 'MR', operator: op.slug, faceValue: mru, faceCurrency: 'MRU' },
  })),
);

type Db = PrismaClient;

async function ensureCategories(prisma: Db, cats: Array<{ slug: string; nameAr: string; nameEn: string; sortOrder: number; isActive?: boolean }>, created: { categories: number }) {
  const ids: Record<string, string> = {};
  for (const c of cats) {
    const existing = await prisma.category.findUnique({ where: { slug: c.slug } });
    ids[c.slug] = existing ? existing.id : (await prisma.category.create({ data: c })).id;
    if (!existing) created.categories++;
  }
  return ids;
}

async function createProducts(
  prisma: Db,
  products: Array<P & { isActive?: boolean }>,
  cat: Record<string, string>,
  game: Record<string, string>,
  created: { products: number },
  withArt: boolean,
) {
  for (const [i, p] of products.entries()) {
    // includes soft-deleted rows: a product the owner removed is not re-added
    if (await prisma.product.findUnique({ where: { sku: p.sku } })) continue;
    await prisma.product.create({
      data: {
        sku: p.sku,
        type: p.type,
        delivery: DeliveryMode.MANUAL,
        nameAr: p.nameAr,
        nameEn: p.nameEn,
        description: p.description,
        imageUrl: withArt ? artUrl(p.sku) : undefined,
        costPrice: p.cost,
        sellPrice: p.sell,
        currency: 'USD',
        categoryId: cat[p.category],
        gameId: p.game ? game[p.game] : null,
        isFeatured: p.isFeatured ?? false,
        isActive: p.isActive ?? true,
        sortOrder: i,
        metadata: p.metadata as Prisma.InputJsonValue | undefined,
      },
    });
    created.products++;
  }
}

async function applyV1(prisma: Db) {
  const created = { categories: 0, games: 0, products: 0 };
  const cat = await ensureCategories(prisma, CATEGORIES, created);

  const game: Record<string, string> = {};
  for (const g of GAMES) {
    const existing = await prisma.game.findUnique({ where: { slug: g.slug } });
    if (existing) {
      game[g.slug] = existing.id;
      continue;
    }
    const row = await prisma.game.create({
      data: {
        slug: g.slug,
        nameAr: g.nameAr,
        nameEn: g.nameEn,
        publisher: g.publisher,
        categoryId: cat[g.category],
        inputSchema: g.inputSchema as unknown as Prisma.InputJsonValue,
        isFeatured: g.isFeatured ?? false,
        sortOrder: g.sortOrder,
      },
    });
    game[g.slug] = row.id;
    created.games++;
  }

  await createProducts(prisma, PRODUCTS, cat, game, created, false);
  return created;
}

async function applyV2(prisma: Db) {
  const created = { categories: 0, games: 0, products: 0, images: 0, moved: 0 };
  const cat = await ensureCategories(prisma, [...CATEGORIES, ...CATEGORIES_V2], created);
  await createProducts(prisma, PRODUCTS_V2, cat, {}, created, true);

  // Fill in art only where the product has no image yet: an image the owner
  // set is never replaced.
  for (const sku of [...PRODUCTS.map((p) => p.sku), ...PRODUCTS_V2.map((p) => p.sku)]) {
    const res = await prisma.product.updateMany({ where: { sku, imageUrl: null }, data: { imageUrl: artUrl(sku) } });
    created.images += res.count;
  }

  const moved = await prisma.product.updateMany({
    where: { sku: { in: RAZER_SKUS }, categoryId: cat['gift-cards'] },
    data: { categoryId: cat['digital-wallets'] },
  });
  created.moved = moved.count;
  return created;
}

async function applyV3(prisma: Db) {
  const created = { categories: 0, games: 0, products: 0, prices: 0, rounding: 0 };
  const cat = await ensureCategories(prisma, CATEGORIES_V3, created);

  const game: Record<string, string> = {};
  for (const op of OPERATORS) {
    const existing = await prisma.game.findUnique({ where: { slug: op.slug } });
    game[op.slug] = existing
      ? existing.id
      : (
          await prisma.game.create({
            data: {
              slug: op.slug, nameAr: op.nameAr, nameEn: op.nameEn, publisher: op.nameEn,
              categoryId: cat['mobile-topup'], inputSchema: mrPhone as unknown as Prisma.InputJsonValue,
              isFeatured: true, sortOrder: op.sortOrder,
            },
          })
        ).id;
    if (!existing) created.games++;
  }
  await createProducts(prisma, PRODUCTS_V3, cat, game, created, true);

  // Ouguiya prices: the face value, set as an override so FX moves never change it.
  const mru = await prisma.currency.findUnique({ where: { code: 'MRU' } });
  if (mru) {
    for (const p of PRODUCTS_V3) {
      const product = await prisma.product.findUnique({ where: { sku: p.sku } });
      if (!product) continue;
      const exists = await prisma.productPrice.findUnique({ where: { productId_currencyCode: { productId: product.id, currencyCode: 'MRU' } } });
      if (exists) continue;
      await prisma.productPrice.create({ data: { productId: product.id, currencyCode: 'MRU', sellPrice: p.mru } });
      created.prices++;
    }
    // converted prices in whole ouguiya (a transfer of 421.88 MRU is awkward), unless the owner chose a step
    const res = await prisma.currency.updateMany({ where: { code: 'MRU', roundingStep: null }, data: { roundingStep: 1 } });
    created.rounding = res.count;
  }
  return created;
}

// ───────────────────────── pack v4 ─────────────────────────
// Brands the owner asked to see first that the catalog lacked: Claude Pro.

const GAMES_V4 = [
  { slug: 'claude', nameAr: 'كلود', nameEn: 'Claude', category: 'subscriptions', publisher: 'Anthropic', inputSchema: accountEmail, sortOrder: 5 },
];

const PRODUCTS_V4: P[] = [
  // priced like ChatGPT Plus: the same $20 list price plus the same margin
  { sku: 'SUB-CLAUDE-PRO-1M', type: S, game: 'claude', category: 'subscriptions', nameAr: 'كلود برو شهر', nameEn: 'Claude Pro 1 Month', sell: 24, cost: 20.5, description: sub(1), isFeatured: true },
];

async function applyV4(prisma: Db) {
  const created = { categories: 0, games: 0, products: 0 };
  const cat = await ensureCategories(prisma, CATEGORIES.filter((c) => c.slug === 'subscriptions'), created);
  const game: Record<string, string> = {};
  for (const g of GAMES_V4) {
    const existing = await prisma.game.findUnique({ where: { slug: g.slug } });
    game[g.slug] = existing
      ? existing.id
      : (
          await prisma.game.create({
            data: {
              slug: g.slug, nameAr: g.nameAr, nameEn: g.nameEn, publisher: g.publisher, categoryId: cat[g.category],
              inputSchema: g.inputSchema as unknown as Prisma.InputJsonValue, sortOrder: g.sortOrder,
            },
          })
        ).id;
    if (!existing) created.games++;
  }
  await createProducts(prisma, PRODUCTS_V4, cat, game, created, true);
  return created;
}


// ───────────────────────── pack v5 ─────────────────────────
// The catalogue checked against official pages and resellers (October 2026,
// at the owner's request): the packages that really exist, prices at a modest
// margin (~8–12%) over the best reputable reseller price, the account value
// each top-up truly needs, customer guides, and the crypto top-ups the owner
// asked for (USDT to Binance, Kast, RedotPay).
//
// Still insert-only in spirit: a price, name or visibility changes only while
// the row still holds the value an earlier pack gave it, so anything the owner
// edited stays as they left it. Guides fill products that have none.

const PACKED = new Map([...PRODUCTS, ...PRODUCTS_V2, ...PRODUCTS_V4].map((p) => [p.sku, p]));

/** [sku, sell, cost] for packs whose market price moved or was guessed. */
const V5_PRICES: Array<[string, number, number]> = [
  ['TOP-PUBG-60', 1.01, 0.91], ['TOP-PUBG-325', 5.21, 4.74], ['TOP-PUBG-660', 10.11, 9.19], ['TOP-PUBG-1800', 26.11, 23.74],
  ['TOP-FF-100', 1.1, 1],
  ['TOP-MLBB-86', 1.33, 1.21], ['TOP-MLBB-172', 2.66, 2.42], ['TOP-MLBB-257', 3.98, 3.62], ['TOP-MLBB-706', 10.65, 9.68],
  ['TOP-CODM-80', 1.09, 0.99], ['TOP-CODM-400', 4.91, 4.46], ['TOP-CODM-800', 9.61, 8.74],
  ['TOP-GENSHIN-60', 1.09, 0.99], ['TOP-GENSHIN-330', 5.49, 4.99], ['TOP-GENSHIN-1090', 16.49, 14.99], ['TOP-GENSHIN-WELKIN', 5.49, 4.99],
  ['TOP-YALLA-5', 5.12, 4.65], ['TOP-YALLA-10', 10.3, 9.36],
  ['TOP-JAWAKER-5', 5.06, 4.6], ['TOP-JAWAKER-10', 10.12, 9.2],
  ['APP-TIKTOK-350', 4.02, 3.65], ['APP-TIKTOK-700', 7.98, 7.25], ['APP-TIKTOK-1400', 15.94, 14.49],
  ['SUB-SNAPPLUS-12M', 32.99, 29.99],
  ['SUB-TGPREMIUM-3M', 13.19, 11.99], ['SUB-TGPREMIUM-12M', 31.89, 28.99],
  ['SUB-DISCORD-NITRO-1M', 10.99, 9.99], ['SUB-DISCORD-NITRO-12M', 109.99, 99.99],
  ['GC-APPLE-US-10', 11.28, 10.25], ['GC-APPLE-US-25', 27.68, 25.63], ['GC-APPLE-US-50', 55.35, 51.25], ['GC-APPLE-US-100', 110.7, 102.5],
  ['GC-GPLAY-US-10', 11.2, 10.18], ['GC-GPLAY-US-25', 27.48, 25.44], ['GC-GPLAY-US-50', 54.96, 50.89],
  ['GC-PSN-US-10', 10.96, 9.96], ['GC-PSN-US-25', 26.18, 24.24], ['GC-PSN-US-50', 52.49, 48.6],
  ['GC-XBOX-US-15', 15.51, 14.1], ['GC-XBOX-US-25', 25.38, 23.5],
  ['GC-STEAM-20', 23.02, 20.93], ['GC-STEAM-50', 54.9, 50.83],
  ['GC-NINTENDO-US-20', 19.84, 18.04],
  ['GC-ROBLOX-10', 10.12, 9.2], ['GC-ROBLOX-25', 24.84, 23],
  ['GC-RAZER-10', 11, 10], ['GC-RAZER-25', 27, 25], ['GC-RAZER-50', 54, 50],
  ['GC-BATTLENET-20', 20.24, 18.4], ['GC-BATTLENET-50', 52.38, 48.5],
  ['GC-MINECRAFT-1720', 8.38, 7.62], ['GC-MINECRAFT-JAVA-BEDROCK', 20.5, 18.98],
  ['GC-AMAZON-US-25', 27.54, 25.5], ['GC-AMAZON-US-50', 55.08, 51],
  ['GC-NETFLIX-US-25', 27.24, 25.22], ['GC-NETFLIX-US-50', 54, 50],
  ['GC-SPOTIFY-US-10', 12.66, 11.51], ['GC-SPOTIFY-US-30', 35.92, 33.26],
  ['GC-TWITCH-US-25', 27.41, 25.38], ['GC-TWITCH-US-50', 54, 50],
];

/** Packages that do not exist (or are a different pack in disguise): hidden, kept for order history. */
const V5_HIDE = ['TOP-FF-310', 'TOP-FF-520', 'TOP-FF-1060', 'APP-TIKTOK-70', 'SUB-SNAPPLUS-1M', 'GC-FORTNITE-1000', 'APP-BIGO-5', 'APP-BIGO-10'];

/** The pack's real contents, where the name hid them ("$5" is 2,320 Yalla diamonds). */
const V5_RENAME: Array<[string, string, string]> = [
  ['TOP-FF-100', 'فري فاير 100+10 جوهرة', 'Free Fire 100+10 Diamonds'],
  ['TOP-CODM-400', 'كول أوف ديوتي موبايل 420 نقطة CP', 'COD Mobile 420 CP (400+20)'],
  ['TOP-CODM-800', 'كول أوف ديوتي موبايل 880 نقطة CP', 'COD Mobile 880 CP (800+80)'],
  ['TOP-YALLA-5', 'يلا لودو 2,320 جوهرة', 'Yalla Ludo 2,320 Diamonds'],
  ['TOP-YALLA-10', 'يلا لودو 5,150 جوهرة', 'Yalla Ludo 5,150 Diamonds'],
  ['TOP-JAWAKER-5', 'جواكر 32,500 توكنز', 'Jawaker 32,500 Tokens'],
  ['TOP-JAWAKER-10', 'جواكر 70,000 توكنز', 'Jawaker 70,000 Tokens'],
];

const CRYPTO = 'نرسل لك USDT بعد تأكيد الدفع، إلى الحساب أو العنوان الذي تكتبه بالضبط.';
const UID_OR_BEP20 = '^([0-9]{6,12}|0x[a-fA-F0-9]{40})$';
const ADDRESS_ANY = '^([0-9]{6,12}|0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33}|[1-9A-HJ-NP-Za-km-z]{32,44})$';
const opt = (value: string, labelAr: string, labelEn: string) => ({ value, labelAr, labelEn });

const GAMES_V5 = [
  {
    slug: 'usdt-binance', nameAr: 'USDT إلى بينانس', nameEn: 'USDT to Binance', publisher: 'Binance', sortOrder: 1,
    inputSchema: [
      { key: 'network', labelAr: 'طريقة الاستلام', labelEn: 'How to receive', type: 'select', required: true, sensitive: false,
        options: [opt('binance_uid', 'تحويل داخلي إلى معرّف Binance (UID)', 'Binance internal transfer (UID)'), opt('bep20', 'شبكة BNB Smart Chain (BEP20)', 'BNB Smart Chain (BEP20)')] },
      { key: 'address', labelAr: 'معرّف Binance أو عنوان المحفظة', labelEn: 'Binance ID or wallet address', type: 'address', required: true, regex: UID_OR_BEP20, sensitive: false },
    ] as Input[],
  },
  {
    slug: 'kast', nameAr: 'بطاقة Kast', nameEn: 'Kast card', publisher: 'Kast', sortOrder: 2,
    inputSchema: [
      { key: 'network', labelAr: 'الشبكة', labelEn: 'Network', type: 'select', required: true, sensitive: false,
        options: [opt('bep20', 'BNB Smart Chain (BEP20)', 'BNB Smart Chain (BEP20)'), opt('trc20', 'Tron (TRC20)', 'Tron (TRC20)'), opt('solana', 'Solana', 'Solana')] },
      { key: 'address', labelAr: 'عنوان الإيداع في Kast', labelEn: 'Kast deposit address', type: 'address', required: true, regex: ADDRESS_ANY, sensitive: false },
    ] as Input[],
  },
  {
    slug: 'redotpay', nameAr: 'بطاقة RedotPay', nameEn: 'RedotPay card', publisher: 'RedotPay', sortOrder: 3,
    inputSchema: [
      { key: 'network', labelAr: 'طريقة الاستلام', labelEn: 'How to receive', type: 'select', required: true, sensitive: false,
        options: [opt('redotpay_uid', 'تحويل داخلي إلى معرّف RedotPay (UID)', 'RedotPay internal transfer (UID)'), opt('trc20', 'Tron (TRC20)', 'Tron (TRC20)'), opt('bep20', 'BNB Smart Chain (BEP20)', 'BNB Smart Chain (BEP20)')] },
      { key: 'address', labelAr: 'معرّف RedotPay أو عنوان المحفظة', labelEn: 'RedotPay ID or wallet address', type: 'address', required: true, regex: ADDRESS_ANY, sensitive: false },
    ] as Input[],
  },
];

/** What a crypto top-up costs in ouguiya: Binance P2P sells USDT around 43.5 MRU (Oct 2026), plus ~3%. */
const USDT_MRU: Record<number, number> = { 10: 450, 20: 900, 50: 2250, 100: 4500 };
const usdtPacks = (prefix: string, game: string, nameAr: string, nameEn: string): Array<P & { mru: number }> =>
  [10, 20, 50, 100].map((n) => ({
    sku: `${prefix}-${n}`, type: G, game, category: 'crypto',
    nameAr: `${nameAr} ${n} USDT`, nameEn: `${nameEn} ${n} USDT`,
    // network fee (≤ 0.01 USDT on BEP20; an internal transfer is free) + ~8%
    sell: Math.round((n + 0.01) * 1.08 * 100) / 100, cost: n + 0.01,
    description: CRYPTO, isFeatured: n === 20, mru: USDT_MRU[n],
    metadata: { asset: 'USDT', amount: n },
  }));

const PRODUCTS_V5: Array<P & { mru?: number }> = [
  { sku: 'TOP-PUBG-3850', type: G, game: 'pubg-mobile', category: 'games', nameAr: 'ببجي موبايل 3850 شدة', nameEn: 'PUBG Mobile 3850 UC', sell: 52.24, cost: 47.49, description: TOPUP },
  { sku: 'TOP-PUBG-8100', type: G, game: 'pubg-mobile', category: 'games', nameAr: 'ببجي موبايل 8100 شدة', nameEn: 'PUBG Mobile 8100 UC', sell: 104.49, cost: 94.99, description: TOPUP },
  { sku: 'TOP-FF-210', type: G, game: 'free-fire', category: 'games', nameAr: 'فري فاير 210+21 جوهرة', nameEn: 'Free Fire 210+21 Diamonds', sell: 2.2, cost: 2, description: TOPUP },
  { sku: 'TOP-FF-530', type: G, game: 'free-fire', category: 'games', nameAr: 'فري فاير 530+53 جوهرة', nameEn: 'Free Fire 530+53 Diamonds', sell: 5.5, cost: 5, description: TOPUP, isFeatured: true },
  { sku: 'TOP-FF-1080', type: G, game: 'free-fire', category: 'games', nameAr: 'فري فاير 1080+108 جوهرة', nameEn: 'Free Fire 1080+108 Diamonds', sell: 11, cost: 10, description: TOPUP },
  { sku: 'TOP-FF-2200', type: G, game: 'free-fire', category: 'games', nameAr: 'فري فاير 2200+220 جوهرة', nameEn: 'Free Fire 2200+220 Diamonds', sell: 22, cost: 20, description: TOPUP },
  { sku: 'TOP-CODM-2400', type: G, game: 'cod-mobile', category: 'games', nameAr: 'كول أوف ديوتي موبايل 2400 نقطة CP', nameEn: 'COD Mobile 2400 CP', sell: 22.75, cost: 20.68, description: TOPUP },
  { sku: 'TOP-GENSHIN-2240', type: G, game: 'genshin-impact', category: 'games', nameAr: 'جنشن إمباكت 1980+260 كريستالة', nameEn: 'Genshin Impact 1980+260 Genesis Crystals', sell: 32.99, cost: 29.99, description: TOPUP },
  { sku: 'TOP-YALLA-2', type: G, game: 'yalla-ludo', category: 'games', nameAr: 'يلا لودو 830 جوهرة', nameEn: 'Yalla Ludo 830 Diamonds', sell: 2.17, cost: 1.97, description: TOPUP },
  { sku: 'TOP-JAWAKER-1', type: G, game: 'jawaker', category: 'games', nameAr: 'جواكر 4,250 توكنز', nameEn: 'Jawaker 4,250 Tokens', sell: 1.02, cost: 0.92, description: TOPUP },
  { sku: 'APP-BIGO-200', type: G, game: 'bigo-live', category: 'apps-topup', nameAr: 'بيجو لايف 200 ماسة', nameEn: 'Bigo Live 200 Diamonds', sell: 4.31, cost: 3.92, description: TOPUP },
  { sku: 'APP-BIGO-500', type: G, game: 'bigo-live', category: 'apps-topup', nameAr: 'بيجو لايف 500 ماسة', nameEn: 'Bigo Live 500 Diamonds', sell: 10.81, cost: 9.83, description: TOPUP },
  { sku: 'APP-TIKTOK-30', type: G, game: 'tiktok', category: 'apps-topup', nameAr: 'تيك توك 30 عملة', nameEn: 'TikTok 30 Coins', sell: 0.41, cost: 0.31, description: appTopup('تيك توك') },
  { sku: 'APP-TIKTOK-3500', type: G, game: 'tiktok', category: 'apps-topup', nameAr: 'تيك توك 3500 عملة', nameEn: 'TikTok 3500 Coins', sell: 39.82, cost: 36.2, description: appTopup('تيك توك') },
  { sku: 'APP-TIKTOK-7000', type: G, game: 'tiktok', category: 'apps-topup', nameAr: 'تيك توك 7000 عملة', nameEn: 'TikTok 7000 Coins', sell: 79.63, cost: 72.39, description: appTopup('تيك توك') },
  { sku: 'APP-TIKTOK-17500', type: G, game: 'tiktok', category: 'apps-topup', nameAr: 'تيك توك 17500 عملة', nameEn: 'TikTok 17500 Coins', sell: 199.09, cost: 180.99, description: appTopup('تيك توك') },
  { sku: 'SUB-TGPREMIUM-6M', type: S, game: 'telegram', category: 'subscriptions', nameAr: 'تيليجرام بريميوم 6 أشهر', nameEn: 'Telegram Premium 6 Months', sell: 17.59, cost: 15.99, description: sub(6) },
  { sku: 'SUB-DISCORD-BASIC-1M', type: S, category: 'subscriptions', nameAr: 'ديسكورد نيترو بيسك شهر', nameEn: 'Discord Nitro Basic 1 Month', sell: 3.29, cost: 2.99, description: sub(1) },
  { sku: 'SUB-DISCORD-BASIC-12M', type: S, category: 'subscriptions', nameAr: 'ديسكورد نيترو بيسك سنة', nameEn: 'Discord Nitro Basic 12 Months', sell: 32.99, cost: 29.99, description: year },
  { sku: 'GC-PSN-US-100', type: C, category: 'gift-cards', nameAr: 'بطاقة بلايستيشن 100$', nameEn: 'PlayStation Store $100 (US)', sell: 108, cost: 100, description: card('بلايستيشن الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-XBOX-US-50', type: C, category: 'gift-cards', nameAr: 'بطاقة إكس بوكس 50$', nameEn: 'Xbox Gift Card $50 (US)', sell: 50.76, cost: 47, description: card('إكس بوكس الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-NINTENDO-US-10', type: C, category: 'gift-cards', nameAr: 'بطاقة نينتندو 10$', nameEn: 'Nintendo eShop $10 (US)', sell: 9.92, cost: 9.02, description: card('نينتندو الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-NINTENDO-US-35', type: C, category: 'gift-cards', nameAr: 'بطاقة نينتندو 35$', nameEn: 'Nintendo eShop $35 (US)', sell: 34.1, cost: 31.57, description: card('نينتندو الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-NINTENDO-US-50', type: C, category: 'gift-cards', nameAr: 'بطاقة نينتندو 50$', nameEn: 'Nintendo eShop $50 (US)', sell: 48.71, cost: 45.1, description: card('نينتندو الأمريكية (US)'), metadata: { region: 'US' } },
  { sku: 'GC-ROBLOX-50', type: C, category: 'gift-cards', nameAr: 'بطاقة روبلوكس 50$', nameEn: 'Roblox Gift Card $50', sell: 49.68, cost: 46, description: card('روبلوكس'), metadata: { region: 'GLOBAL' } },
  ...usdtPacks('CRYPTO-USDT', 'usdt-binance', 'شحن', 'Top-up'),
  ...usdtPacks('CRYPTO-KAST', 'kast', 'شحن بطاقة Kast', 'Kast card top-up'),
  ...usdtPacks('CRYPTO-REDOTPAY', 'redotpay', 'شحن بطاقة RedotPay', 'RedotPay card top-up'),
];

/** Mauritanian numbers by operator (ITU numbering plan): Chinguitel 2x, Mattel 3x, Mauritel 4x. */
const OPERATOR_PREFIX: Record<string, string> = { chinguitel: '2', mattel: '3', mauritel: '4' };

/** Account values whose label or key was wrong (Jawaker wants the numeric Player Number, Bigo its Bigo ID). */
const V5_INPUTS: Record<string, Input[]> = {
  jawaker: [{ key: 'player_id', labelAr: 'رقم اللاعب في جواكر', labelEn: 'Jawaker Player Number', type: 'text', required: true, regex: '^[0-9]{4,12}$', sensitive: false }],
  'bigo-live': [{ key: 'bigo_id', labelAr: 'معرّف بيجو (Bigo ID)', labelEn: 'Bigo ID', type: 'text', required: true, regex: '^[0-9A-Za-z._]{3,30}$', sensitive: false }],
  ...Object.fromEntries(
    Object.entries(OPERATOR_PREFIX).map(([slug, d]) => [
      slug,
      [{ ...mrPhone[0], regex: `^(\\+?222)?${d}[0-9]{7}$` }],
    ]),
  ),
};

/** Which guide (catalog-guides.ts) each game carries, and which SKUs each guide covers. */
const GUIDE_GAMES: Record<string, string[]> = {
  pubg: ['pubg-mobile'], freefire: ['free-fire'], mlbb: ['mobile-legends'], codm: ['cod-mobile'], genshin: ['genshin-impact'],
  yalla: ['yalla-ludo'], jawaker: ['jawaker'], bigo: ['bigo-live'], tiktok: ['tiktok'], snapchat: ['snapchat'], telegram: ['telegram'],
  usdt: ['usdt-binance'], kast: ['kast'], redotpay: ['redotpay'], airtime: ['mattel', 'mauritel', 'chinguitel'],
};
const GUIDE_SKUS: Record<string, string[]> = {
  pubg: ['TOP-PUBG-'], freefire: ['TOP-FF-'], mlbb: ['TOP-MLBB-'], codm: ['TOP-CODM-'], genshin: ['TOP-GENSHIN-'],
  yalla: ['TOP-YALLA-'], jawaker: ['TOP-JAWAKER-'], bigo: ['APP-BIGO-'], tiktok: ['APP-TIKTOK-'], snapchat: ['SUB-SNAPPLUS-'],
  telegram: ['SUB-TGPREMIUM-'], discord: ['SUB-DISCORD-'], apple: ['GC-APPLE-'], gplay: ['GC-GPLAY-'], psn: ['GC-PSN-'],
  xbox: ['GC-XBOX-'], steam: ['GC-STEAM-'], nintendo: ['GC-NINTENDO-'], roblox: ['GC-ROBLOX-'], razer: ['GC-RAZER-'],
  battlenet: ['GC-BATTLENET-'], minecraft: ['GC-MINECRAFT-'], amazon: ['GC-AMAZON-'], netflixcard: ['GC-NETFLIX-'],
  twitch: ['GC-TWITCH-'], usdt: ['CRYPTO-USDT-'], kast: ['CRYPTO-KAST-'], redotpay: ['CRYPTO-REDOTPAY-'],
  airtime: ['TOP-MATTEL-', 'TOP-MAURITEL-', 'TOP-CHINGUITEL-'],
};

async function applyV5(prisma: Db) {
  const done = { categories: 0, games: 0, products: 0, prices: 0, hidden: 0, renamed: 0, inputs: 0, guides: 0, mruPrices: 0 };

  // the owner asked to sell crypto top-ups: the section v2 created hidden opens
  const cat = await ensureCategories(prisma, [...CATEGORIES, ...CATEGORIES_V2], done);
  await prisma.category.updateMany({ where: { slug: 'crypto', isActive: false }, data: { isActive: true } });

  for (const [sku, sell, cost] of V5_PRICES) {
    const was = PACKED.get(sku);
    if (!was) continue;
    const res = await prisma.product.updateMany({ where: { sku, sellPrice: was.sell }, data: { sellPrice: sell, costPrice: cost } });
    done.prices += res.count;
  }
  for (const sku of V5_HIDE) {
    const was = PACKED.get(sku);
    if (!was) continue;
    const res = await prisma.product.updateMany({ where: { sku, sellPrice: was.sell, isActive: true }, data: { isActive: false } });
    done.hidden += res.count;
  }
  for (const [sku, nameAr, nameEn] of V5_RENAME) {
    const was = PACKED.get(sku);
    if (!was) continue;
    const res = await prisma.product.updateMany({ where: { sku, nameAr: was.nameAr }, data: { nameAr, nameEn } });
    done.renamed += res.count;
  }

  // new account forms (crypto) and corrected ones
  const game: Record<string, string> = {};
  for (const g of GAMES_V5) {
    const existing = await prisma.game.findUnique({ where: { slug: g.slug } });
    game[g.slug] = existing
      ? existing.id
      : (
          await prisma.game.create({
            data: {
              slug: g.slug, nameAr: g.nameAr, nameEn: g.nameEn, publisher: g.publisher, categoryId: cat['crypto'],
              inputSchema: g.inputSchema as unknown as Prisma.InputJsonValue, sortOrder: g.sortOrder,
            },
          })
        ).id;
    if (!existing) done.games++;
  }
  for (const [slug, schema] of Object.entries(V5_INPUTS)) {
    const res = await prisma.game.updateMany({ where: { slug }, data: { inputSchema: schema as unknown as Prisma.InputJsonValue } });
    done.inputs += res.count;
  }
  for (const slug of ['pubg-mobile', 'free-fire', 'mobile-legends', 'cod-mobile', 'genshin-impact', 'yalla-ludo', 'tiktok', 'snapchat', 'telegram']) {
    game[slug] ??= (await prisma.game.findUnique({ where: { slug } }))?.id ?? '';
  }
  for (const slug of ['jawaker', 'bigo-live']) game[slug] = (await prisma.game.findUnique({ where: { slug } }))?.id ?? '';

  await createProducts(prisma, PRODUCTS_V5, cat, game, done, true);

  // crypto in ouguiya follows the local USDT price, not the official dollar
  const mru = await prisma.currency.findUnique({ where: { code: 'MRU' } });
  if (mru) {
    for (const p of PRODUCTS_V5) {
      if (!p.mru) continue;
      const product = await prisma.product.findUnique({ where: { sku: p.sku } });
      if (!product) continue;
      const exists = await prisma.productPrice.findUnique({ where: { productId_currencyCode: { productId: product.id, currencyCode: 'MRU' } } });
      if (exists) continue;
      await prisma.productPrice.create({ data: { productId: product.id, currencyCode: 'MRU', sellPrice: p.mru } });
      done.mruPrices++;
    }
  }

  // where to find each account value, in the three languages (labels and rules stay as they are)
  for (const [guide, slugs] of Object.entries(GUIDE_GAMES)) {
    const help = GUIDES[guide]?.help;
    if (!help) continue;
    for (const slug of slugs) {
      const row = await prisma.game.findUnique({ where: { slug } });
      if (!row || !Array.isArray(row.inputSchema)) continue;
      const schema = (row.inputSchema as unknown as Input[]).map((f) =>
        help[f.key] && !f.helpAr ? { ...f, helpAr: help[f.key].ar, helpFr: help[f.key].fr, helpEn: help[f.key].en } : f,
      );
      await prisma.game.update({ where: { id: row.id }, data: { inputSchema: schema as unknown as Prisma.InputJsonValue } });
    }
  }

  // before-paying / after-delivery steps on every product of the brand that has none yet
  for (const [guide, prefixes] of Object.entries(GUIDE_SKUS)) {
    const g = GUIDES[guide];
    if (!g || (!g.before?.length && !g.after?.length && !g.warning)) continue;
    const steps = { before: g.before, after: g.after, warning: g.warning };
    const rows = await prisma.product.findMany({ where: { OR: prefixes.map((p) => ({ sku: { startsWith: p } })) } });
    for (const row of rows) {
      const meta = (row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}) as Record<string, unknown>;
      if (meta.guide) continue;
      await prisma.product.update({ where: { id: row.id }, data: { metadata: { ...meta, guide: steps } as Prisma.InputJsonValue } });
      done.guides++;
    }
  }
  return done;
}

// ───────────────────────── pack v6 ─────────────────────────

/**
 * Products the October audit found cannot be delivered as sold (the research
 * doc: a US card that does not work on EU/MENA servers or Mauritanian
 * accounts, a subscription that only comes by logging into the customer's
 * account, a service not offered in Mauritania), plus a stray Free Fire item
 * that sat on the PUBG page at eleven times its price. The owner asked to deal
 * with them: they are hidden once, not deleted — the owner can show any of them
 * again from the dashboard, and the marker keeps this pack from hiding it twice.
 */
export const V6_HIDE = [
  'FF-DIAMONDS-100',
  'GC-RIOT-10', 'GC-RIOT-25', 'GC-RIOT-50',
  'GC-SPOTIFY-US-10', 'GC-SPOTIFY-US-30',
  'SUB-SPOTIFY-1M', 'SUB-SPOTIFY-3M', 'SUB-SPOTIFY-12M',
  'SUB-CHATGPT-1M', 'SUB-CLAUDE-PRO-1M', 'SUB-CANVA-12M',
  'SUB-YTPREMIUM-1M', 'SUB-DISNEY-1M', 'SUB-APPLEMUSIC-1M', 'SUB-NFLX-1M',
];

async function applyV6(prisma: Db) {
  const res = await prisma.product.updateMany({ where: { sku: { in: V6_HIDE }, isActive: true }, data: { isActive: false } });

  // the USDT help named a choice («Binance ID») the menu does not have; it now names the menu's own
  // choices, in steps that read right to left. Only where the help is still the pack's first text.
  let help = 0;
  const usdt = GUIDES.usdt?.help;
  const row = await prisma.game.findUnique({ where: { slug: 'usdt-binance' } });
  if (usdt && row && Array.isArray(row.inputSchema)) {
    const STALE: Record<string, string> = { network: '«Binance ID»', address: 'Binance ID:' };
    const schema = (row.inputSchema as unknown as Input[]).map((f) => {
      const fresh = usdt[f.key];
      if (!fresh || !STALE[f.key] || !f.helpAr?.includes(STALE[f.key])) return f;
      help++;
      return { ...f, helpAr: fresh.ar, helpFr: fresh.fr, helpEn: fresh.en };
    });
    if (help) await prisma.game.update({ where: { id: row.id }, data: { inputSchema: schema as unknown as Prisma.InputJsonValue } });
  }
  return { hidden: res.count, help };
}

const PACKS: Array<{ key: string; description: string; apply: (prisma: Db) => Promise<Record<string, number>> }> = [
  { key: CATALOG_PACK_KEY, description: 'Starter catalog pack applied (insert-only, once).', apply: applyV1 },
  { key: CATALOG_PACK_V2_KEY, description: 'Catalog pack v2: more brands, wallets/crypto sections, product art (once).', apply: applyV2 },
  { key: CATALOG_PACK_V3_KEY, description: 'Catalog pack v3: Mauritanian mobile airtime priced in MRU (once).', apply: applyV3 },
  { key: CATALOG_PACK_V4_KEY, description: 'Catalog pack v4: Claude Pro (once).', apply: applyV4 },
  { key: CATALOG_PACK_V5_KEY, description: 'Catalog pack v5: researched packages, prices, inputs, guides, crypto top-ups (once).', apply: applyV5 },
  { key: CATALOG_PACK_V6_KEY, description: 'Catalog pack v6: hide products that cannot be delivered as sold (once; the owner can show them again).', apply: applyV6 },
];

/** Apply every pack not yet recorded, in order. */
export async function applyCatalogPack(client?: PrismaClient): Promise<void> {
  const prisma = client ?? new PrismaClient();
  try {
    for (const pack of PACKS) {
      if (await prisma.systemSetting.findUnique({ where: { key: pack.key } })) {
        console.log(`catalog pack: ${pack.key} already applied, skipping`);
        continue;
      }
      const result = await pack.apply(prisma);
      await prisma.systemSetting.create({
        data: {
          key: pack.key,
          group: 'catalog',
          description: pack.description,
          value: { appliedAt: new Date().toISOString(), ...result } as Prisma.InputJsonValue,
        },
      });
      console.log(`catalog pack: ${pack.key} applied`, JSON.stringify(result));
    }
  } finally {
    if (!client) await prisma.$disconnect();
  }
}

/** Exposed for tests/tooling: every pack product SKU (v1 + v2). */
export const CATALOG_PACK_SKUS = [...PRODUCTS, ...PRODUCTS_V2, ...PRODUCTS_V3, ...PRODUCTS_V4, ...PRODUCTS_V5].map((p) => p.sku);
/** v2 products that are created hidden (crypto vouchers). */
export const CATALOG_PACK_HIDDEN_SKUS = PRODUCTS_V2.filter((p) => p.isActive === false).map((p) => p.sku);
