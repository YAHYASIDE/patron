/**
 * Generates the product card art in public/art/<sku lowercase>.svg for every
 * SKU in the API's starter catalog (apps/api/src/bootstrap/catalog-pack.ts).
 *
 * Each card is the brand colour, the brand mark and the denomination. Marks come
 * from Simple Icons (CC0 path data; the marks themselves remain trademarks of
 * their owners and are used only to identify the product being sold). Brands
 * that Simple Icons does not carry get their name set in type instead of a logo.
 *
 * Not part of the build. To regenerate after adding SKUs:
 *   npm i --no-save simple-icons@15 && node scripts/generate-product-art.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as si from 'simple-icons';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, '..', 'public', 'art');
const PACK = join(here, '..', '..', 'api', 'src', 'bootstrap', 'catalog-pack.ts');

const icons = Object.fromEntries(Object.values(si).filter((i) => i && i.slug).map((i) => [i.slug, i]));

// icon: Simple Icons slug. word: set in type when there is no mark.
// bg: card colour. fg: mark/text colour (white by default).
const BRANDS = {
  pubg: { icon: 'pubg', bg: '#15130f', fg: '#F4B942' },
  freefire: { word: 'FREE FIRE', bg: '#E8590C' },
  mlbb: { word: 'MOBILE LEGENDS', bg: '#1F5FBF' },
  codm: { word: 'CALL OF DUTY', bg: '#1a1a1a', fg: '#E8C547' },
  genshin: { word: 'GENSHIN IMPACT', bg: '#3D5AA8' },
  yalla: { word: 'YALLA LUDO', bg: '#169B4C' },
  jawaker: { word: 'JAWAKER', bg: '#0F766E' },
  tiktok: { icon: 'tiktok', bg: '#0b0b0d' },
  bigo: { word: 'BIGO LIVE', bg: '#00A3C4' },
  apple: { icon: 'apple', bg: '#1d1d1f' },
  gplay: { icon: 'googleplay', bg: '#01875F' },
  psn: { icon: 'playstation', bg: '#0070D1' },
  xbox: { word: 'XBOX', bg: '#107C10' },
  steam: { icon: 'steam', bg: '#1B2838' },
  roblox: { icon: 'roblox', bg: '#393B3D' },
  razer: { icon: 'razer', bg: '#101010', fg: '#44D62C' },
  amazon: { word: 'amazon', bg: '#232F3E', fg: '#FF9900' },
  fortnite: { icon: 'fortnite', bg: '#5B2BD9' },
  nintendo: { word: 'NINTENDO', bg: '#E60012' },
  netflix: { icon: 'netflix', bg: '#141414', fg: '#E50914' },
  spotify: { icon: 'spotify', bg: '#121212', fg: '#1ED760' },
  riot: { icon: 'riotgames', bg: '#D13639' },
  battlenet: { icon: 'battledotnet', bg: '#148EFF' },
  minecraft: { word: 'MINECRAFT', bg: '#3C8527' },
  twitch: { icon: 'twitch', bg: '#9146FF' },
  binance: { icon: 'binance', bg: '#181A20', fg: '#F0B90B' },
  shahid: { word: 'shahid', bg: '#0b0b0b', fg: '#17E5A0' },
  osn: { word: 'OSN+', bg: '#161616' },
  disney: { word: 'Disney+', bg: '#0E1F64' },
  youtube: { icon: 'youtube', bg: '#0f0f0f', fg: '#FF0033' },
  anghami: { word: 'anghami', bg: '#7B2CBF' },
  applemusic: { icon: 'applemusic', bg: '#FA243C' },
  snapchat: { icon: 'snapchat', bg: '#FFFC00', fg: '#111111' },
  telegram: { icon: 'telegram', bg: '#229ED9' },
  chatgpt: { icon: 'openai', bg: '#0d0d0d' },
  canva: { icon: 'canva', bg: '#00B3C2' },
  discord: { icon: 'discord', bg: '#5865F2' },
  gamepass: { word: 'GAME PASS', bg: '#107C10' },
  psplus: { icon: 'playstation', bg: '#F5B700', fg: '#151515' },
  m365: { word: 'Microsoft 365', bg: '#0F6CBD' },
  mattel: { word: 'MATTEL', bg: '#D7141A' },
  mauritel: { word: 'MAURITEL', bg: '#0A5BA8' },
  chinguitel: { word: 'CHINGUITEL', bg: '#0E8A3E' },
};

const months = (code) => (code === '1M' ? '1 MONTH' : code === '12M' ? '12 MONTHS' : `${parseInt(code, 10)} MONTHS`);
const num = (n) => Number(n).toLocaleString('en-US');

/** SKU → { brand, label, sub } */
function specFor(sku) {
  let m;
  if ((m = sku.match(/^TOP-PUBG-(\d+)$/))) return { brand: 'pubg', label: `${num(m[1])} UC` };
  if ((m = sku.match(/^TOP-FF-(\d+)$/))) return { brand: 'freefire', label: `${num(m[1])} DIAMONDS` };
  if ((m = sku.match(/^TOP-MLBB-(\d+)$/))) return { brand: 'mlbb', label: `${num(m[1])} DIAMONDS` };
  if ((m = sku.match(/^TOP-CODM-(\d+)$/))) return { brand: 'codm', sub: 'MOBILE', label: `${num(m[1])} CP` };
  if (sku === 'TOP-GENSHIN-WELKIN') return { brand: 'genshin', label: 'WELKIN MOON' };
  if ((m = sku.match(/^TOP-GENSHIN-(\d+)$/))) return { brand: 'genshin', label: `${num(m[1])} CRYSTALS` };
  if ((m = sku.match(/^TOP-YALLA-(\d+)$/))) return { brand: 'yalla', label: `$${m[1]}` };
  if ((m = sku.match(/^TOP-JAWAKER-(\d+)$/))) return { brand: 'jawaker', sub: 'TOKENS', label: `$${m[1]}` };
  if ((m = sku.match(/^APP-TIKTOK-(\d+)$/))) return { brand: 'tiktok', label: `${num(m[1])} COINS` };
  if ((m = sku.match(/^APP-BIGO-(\d+)$/))) return { brand: 'bigo', sub: 'DIAMONDS', label: `$${m[1]}` };
  if (sku === 'GC-FORTNITE-1000') return { brand: 'fortnite', label: '1,000 V-BUCKS' };
  if (sku === 'GC-MINECRAFT-JAVA-BEDROCK') return { brand: 'minecraft', label: 'JAVA + BEDROCK' };
  if (sku === 'GC-MINECRAFT-1720') return { brand: 'minecraft', label: '1,720 MINECOINS' };
  if ((m = sku.match(/^TOP-(MATTEL|MAURITEL|CHINGUITEL)-(\d+)$/))) return { brand: m[1].toLowerCase(), sub: 'AIRTIME', label: `${num(m[2])} MRU` };
  if ((m = sku.match(/^GC-BINANCE-(\d+)$/))) return { brand: 'binance', sub: 'GIFT CARD', label: `${m[1]} USDT` };
  const gc = {
    APPLE: 'apple', GPLAY: 'gplay', PSN: 'psn', XBOX: 'xbox', STEAM: 'steam', ROBLOX: 'roblox', RAZER: 'razer',
    AMAZON: 'amazon', NINTENDO: 'nintendo', NETFLIX: 'netflix', SPOTIFY: 'spotify', RIOT: 'riot',
    BATTLENET: 'battlenet', TWITCH: 'twitch',
  };
  if ((m = sku.match(/^GC-([A-Z]+)(?:-US)?-(\d+)$/)) && gc[m[1]]) {
    const sub = m[1] === 'RAZER' ? 'GOLD' : m[1] === 'BATTLENET' ? 'BLIZZARD' : 'GIFT CARD';
    return { brand: gc[m[1]], sub, label: `$${m[2]}` };
  }
  const subs = {
    NFLX: ['netflix', ''], SHAHID: ['shahid', 'VIP'], OSN: ['osn', ''], DISNEY: ['disney', ''],
    YTPREMIUM: ['youtube', 'PREMIUM'], SPOTIFY: ['spotify', 'PREMIUM'], ANGHAMI: ['anghami', 'PLUS'],
    APPLEMUSIC: ['applemusic', 'APPLE MUSIC'], SNAPPLUS: ['snapchat', 'SNAPCHAT+'], TGPREMIUM: ['telegram', 'PREMIUM'],
    CHATGPT: ['chatgpt', 'CHATGPT PLUS'], CANVA: ['canva', 'PRO'], 'DISCORD-NITRO': ['discord', 'NITRO'],
    'GAMEPASS-ULT': ['gamepass', 'ULTIMATE'], 'PSPLUS-ESS': ['psplus', 'PLUS ESSENTIAL'],
  };
  if ((m = sku.match(/^SUB-([A-Z-]+?)-(\d+M)$/)) && subs[m[1]]) {
    const [brand, sub] = subs[m[1]];
    return { brand, sub, label: months(m[2]) };
  }
  if ((m = sku.match(/^LIC-M365-(PERSONAL|FAMILY)-(\d+M)$/))) return { brand: 'm365', sub: m[1], label: months(m[2]) };
  return null;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Mix a hex colour toward black by `t` (0..1). */
function darken(hex, t) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.round(v * (1 - t)).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

function svg({ brand, label, sub }) {
  const b = BRANDS[brand];
  const fg = b.fg ?? '#FFFFFF';
  const font = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
  let mark;
  if (b.icon) {
    const icon = icons[b.icon];
    if (!icon) throw new Error(`missing simple-icon ${b.icon}`);
    const size = 132;
    mark = `<g transform="translate(${320 - size / 2} ${172 - size / 2}) scale(${size / 24})"><path fill="${fg}" d="${icon.path}"/></g>`;
  } else {
    // ~0.7em per bold uppercase glyph keeps long names inside a 540px band
    const fs = Math.min(84, Math.floor(540 / (b.word.length * 0.7)));
    mark = `<text x="320" y="${172 + fs * 0.35}" text-anchor="middle" font-family="${font}" font-weight="800" font-size="${fs}" letter-spacing="1" fill="${fg}">${esc(b.word)}</text>`;
  }
  const labelSize = label.length > 12 ? 46 : 58;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480" width="640" height="480" role="img" aria-label="${esc([b.word ?? icons[b.icon]?.title, sub, label].filter(Boolean).join(' '))}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${b.bg}"/>
      <stop offset="1" stop-color="${darken(b.bg, 0.35)}"/>
    </linearGradient>
  </defs>
  <rect width="640" height="480" fill="url(#g)"/>
  <circle cx="560" cy="40" r="210" fill="${fg}" opacity="0.06"/>
  <circle cx="60" cy="470" r="150" fill="${fg}" opacity="0.05"/>
  ${mark}
  ${sub ? `<text x="320" y="318" text-anchor="middle" font-family="${font}" font-weight="700" font-size="24" letter-spacing="5" fill="${fg}" opacity="0.78">${esc(sub)}</text>` : ''}
  <text x="320" y="${sub ? 384 : 368}" text-anchor="middle" font-family="${font}" font-weight="800" font-size="${labelSize}" fill="${fg}">${esc(label)}</text>
</svg>
`;
}

const source = readFileSync(PACK, 'utf8');
const skus = [...source.matchAll(/sku: '([A-Z0-9]+-[A-Z0-9-]+)'/g)].map((m) => m[1]);
// v3 airtime SKUs are built from the operator list × face values (`TOP-${op.sku}-${mru}`)
const faces = JSON.parse(source.match(/const AIRTIME_MRU = (\[[^\]]*\])/)[1]);
for (const [, op] of source.matchAll(/slug: '[a-z]+', sku: '([A-Z]+)'/g)) for (const f of faces) skus.push(`TOP-${op}-${f}`);
mkdirSync(OUT, { recursive: true });
const missing = [];
for (const sku of skus) {
  const spec = specFor(sku);
  if (!spec) {
    missing.push(sku);
    continue;
  }
  writeFileSync(join(OUT, `${sku.toLowerCase()}.svg`), svg(spec));
}
if (missing.length) {
  console.error('No art mapping for:', missing.join(', '));
  process.exit(1);
}
console.log(`wrote ${skus.length} cards to public/art`);
