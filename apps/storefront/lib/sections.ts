import type { Brand } from './brands';

/**
 * How the shop arranges brands, chosen by the owner: the brands shown first,
 * and the sections everything else sits in. Brands are listed by key
 * (lib/brands.ts brandKey); a brand not listed here (e.g. one the owner adds
 * later) falls into a section by its catalog category.
 */

/** "الأكثر طلبًا", in the owner's order. */
export const TOP_BRANDS = [
  'g-tiktok',
  'g-snapchat',
  'g-canva',
  'sub-ytpremium',
  'g-chatgpt',
  'g-claude',
  'g-pubg-mobile',
  'g-free-fire',
  'g-yalla-ludo',
  'sub-nflx',
  'gc-apple-us',
  'gc-gplay-us',
  'g-telegram',
  'lic-m365',
];

type Section = { id: string; label: string; keys: string[]; categories: string[] };

export const SECTIONS: Section[] = [
  {
    id: 'social',
    label: 'التواصل الاجتماعي',
    keys: ['g-tiktok', 'g-snapchat', 'g-telegram', 'sub-ytpremium', 'sub-discord-nitro', 'g-bigo-live'],
    categories: ['apps-topup'],
  },
  {
    id: 'ai',
    label: 'الذكاء الاصطناعي والعمل',
    keys: ['g-chatgpt', 'g-claude', 'g-canva', 'lic-m365'],
    categories: ['software'],
  },
  { id: 'games', label: 'شحن الألعاب', keys: [], categories: ['games'] },
  {
    id: 'game-cards',
    label: 'بطاقات ومنصّات الألعاب',
    keys: [
      'gc-psn-us',
      'gc-xbox-us',
      'gc-steam',
      'gc-roblox',
      'gc-fortnite',
      'gc-riot',
      'gc-battlenet',
      'gc-minecraft',
      'gc-nintendo-us',
      'sub-gamepass-ult',
      'sub-psplus-ess',
      'gc-razer',
    ],
    categories: [],
  },
  {
    id: 'entertainment',
    label: 'الأفلام والموسيقى',
    keys: [
      'sub-nflx',
      'sub-shahid',
      'sub-osn',
      'sub-disney',
      'sub-spotify',
      'sub-anghami',
      'sub-applemusic',
      'gc-netflix-us',
      'gc-spotify-us',
      'gc-twitch-us',
    ],
    categories: ['subscriptions'],
  },
  {
    id: 'cards',
    label: 'بطاقات المتاجر والمحافظ',
    keys: ['gc-apple-us', 'gc-gplay-us', 'gc-amazon-us'],
    categories: ['gift-cards', 'digital-wallets', 'crypto'],
  },
  { id: 'mobile', label: 'رصيد الهاتف', keys: [], categories: ['mobile-topup'] },
  { id: 'other', label: 'منتجات أخرى', keys: [], categories: [] },
];

export function sectionOf(brand: Brand): Section {
  return (
    SECTIONS.find((s) => s.keys.includes(brand.key)) ??
    SECTIONS.find((s) => brand.categorySlug !== null && s.categories.includes(brand.categorySlug)) ??
    SECTIONS[SECTIONS.length - 1]
  );
}

/** Each section with its brands (listed ones in the listed order, then the rest), empty ones left out. */
export function bySection(brands: Brand[]): { section: Section; brands: Brand[] }[] {
  return SECTIONS.map((section) => {
    const inIt = brands.filter((b) => sectionOf(b).id === section.id);
    const rank = (b: Brand) => {
      const i = section.keys.indexOf(b.key);
      return i === -1 ? section.keys.length : i;
    };
    return { section, brands: inIt.sort((a, b) => rank(a) - rank(b)) };
  }).filter((g) => g.brands.length > 0);
}

/** The top brands that exist in the catalog, in the owner's order; featured brands fill in if few do. */
export function topBrands(brands: Brand[]): Brand[] {
  const byKey = new Map(brands.map((b) => [b.key, b]));
  const top = TOP_BRANDS.map((k) => byKey.get(k)).filter((b): b is Brand => !!b);
  return top.length >= 4 ? top : brands.filter((b) => b.featured).slice(0, 12);
}
