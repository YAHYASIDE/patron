// Live shop check: wakes the Render services, then checks the API, the store
// (Arabic + French, phone → desktop) and the dashboard sign-in page. Every
// failure is collected (with a screenshot of the page) into out/report.md, and
// the process exits 1 when anything failed. No test runner: plain Node + Playwright.
//
//   STORE_URL=… ADMIN_URL=… API_URL=…/api/v1 node check.mjs
//
// Optional: CHROMIUM_PATH (use a local Chromium build instead of Playwright's),
// WAKE_TIMEOUT_MS (default 240000), MIN_GAMES (default 20).
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const trim = (u) => u.replace(/\/+$/, '');
const STORE = trim(process.env.STORE_URL ?? 'https://etssadagha-store.onrender.com');
const ADMIN = trim(process.env.ADMIN_URL ?? 'https://etssadagha-shop.onrender.com');
const API = trim(process.env.API_URL ?? 'https://etssadagha-api.onrender.com/api/v1');
const WAKE_TIMEOUT = Number(process.env.WAKE_TIMEOUT_MS ?? 240_000);
// The starter catalog pack seeds exactly 20 brands; fewer means the catalog is broken.
const MIN_GAMES = Number(process.env.MIN_GAMES ?? 20);
const NAV_TIMEOUT = 60_000;

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const WIDTHS = [320, 390, 1280];
const LANGS = ['ar', 'fr'];
const PAGES = ['/', '/products', '/brands/g-pubg-mobile', '/brands/g-usdt-binance', '/login', '/cart', '/help', '/terms'];
const PWA_FILES = ['/manifest.webmanifest', '/sw.js', '/offline.html', '/icons/icon-192.png'];
const MANUAL_METHODS = {
  Bankily: null,
  Masrvi: null,
  Sedad: null,
  Klic: null,
  'BIM Bank': null,
  Nita: '22227268',
  'Orange Money': '74646158',
};

const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ─── result bookkeeping ───
const failures = [];
let passed = 0;
function ok(cond, f) {
  if (cond) passed++;
  else fail(f);
  return cond;
}
function fail({ ar, en, page = '-', width = '-', lang = '-', detail = '' }) {
  failures.push({ ar, en, page, width, lang, detail: String(detail).slice(0, 300), shot: '' });
  const at = [page, width === '-' ? '' : `${width}px`, lang === '-' ? '' : lang].filter(Boolean).join(' ');
  log(`FAIL  ${en} — ${at}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`);
}

// ─── 1. wake the services (Render free tier sleeps after 15 idle minutes) ───
async function wake(name, url) {
  const start = Date.now();
  let last = '';
  log(`waking ${name}: ${url}`);
  while (Date.now() - start < WAKE_TIMEOUT) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'follow' });
      last = `HTTP ${r.status}`;
      if (r.status === 200) {
        log(`${name} is awake (${Math.round((Date.now() - start) / 1000)} s)`);
        return true;
      }
    } catch (e) {
      last = e.cause?.code ?? e.name ?? String(e);
    }
    log(`${name} not ready yet (${last}), retrying…`);
    await new Promise((r) => setTimeout(r, 5_000));
  }
  fail({ ar: 'الخدمة لم تستيقظ', en: 'Service did not wake up', page: url, detail: `${last} after ${WAKE_TIMEOUT / 1000} s` });
  return false;
}

const awake = await Promise.all([
  wake('API', `${API}/health/ready`),
  wake('store', `${STORE}/`),
  wake('dashboard', `${ADMIN}/login`),
]);
passed += awake.filter(Boolean).length;

// ─── 2. API checks ───
async function getJson(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      const r = await fetch(API + path, { signal: AbortSignal.timeout(30_000), headers: { accept: 'application/json' } });
      if (r.status >= 500 && attempt < 2) continue;
      const text = await r.text();
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      return { status: r.status, body, text };
    } catch (e) {
      if (attempt >= 2) return { status: 0, body: null, text: String(e) };
    }
  }
}

log('API checks');
{
  const page = '/catalog/rates';
  const { status, body } = await getJson(page);
  if (ok(status === 200, { ar: 'أسعار الصرف لا تجيب', en: 'Exchange rates not answering', page, detail: `HTTP ${status}` })) {
    for (const cur of ['MRU', 'XOF', 'DZD', 'EUR']) {
      const v = body?.rates?.[cur];
      ok(typeof v === 'number' && v > 0, { ar: `سعر ${cur} مفقود`, en: `${cur} rate missing or ≤ 0`, page, detail: `got ${JSON.stringify(v)}` });
    }
  }
}
{
  const page = '/catalog/stats';
  const { status, body } = await getJson(page);
  ok(status === 200 && body && typeof body === 'object', { ar: 'الإحصاءات لا تجيب', en: 'Stats not answering', page, detail: `HTTP ${status}` });
}
{
  const page = '/payments/manual-accounts';
  const { status, body } = await getJson(page);
  if (ok(status === 200 && Array.isArray(body?.accounts), { ar: 'حسابات الدفع لا تجيب', en: 'Payment accounts not answering', page, detail: `HTTP ${status}` })) {
    const accounts = body.accounts;
    for (const [method, number] of Object.entries(MANUAL_METHODS)) {
      const a = accounts.find((x) => x.method === method);
      ok(Boolean(a), { ar: `وسيلة الدفع ${method} غير موجودة`, en: `Payment method ${method} missing`, page });
      if (a && number) {
        ok(String(a.accountNumber).replace(/\s/g, '') === number, {
          ar: `رقم ${method} خاطئ`,
          en: `${method} number is wrong`,
          page,
          detail: `expected ${number}, got ${JSON.stringify(a.accountNumber)}`,
        });
      }
    }
    const empty = accounts.filter((a) => a.enabled !== false && !String(a.accountNumber ?? '').trim());
    ok(empty.length === 0, {
      ar: 'حساب دفع مفعّل بلا رقم',
      en: 'Enabled payment account without a number',
      page,
      detail: empty.map((a) => a.method).join(', '),
    });
  }
}
{
  // the full backup is live and only for the owner: signed out it must answer 401, not 404 (an older API)
  const page = '/admin/backup/status';
  const { status } = await getJson(page);
  ok(status === 401, { ar: 'النسخة الاحتياطية الكاملة غير منشورة أو مفتوحة بلا دخول', en: 'Full backup not deployed, or open without sign-in', page, detail: `HTTP ${status}` });
}
{
  const page = '/catalog/banners';
  const { status, body } = await getJson(page);
  ok(status === 200 && Array.isArray(body), { ar: 'اللافتات لا تجيب', en: 'Banners not answering as an array', page, detail: `HTTP ${status}` });
}
{
  const page = '/catalog/games?limit=100';
  const { status, body } = await getJson(page);
  const count = body?.meta?.total ?? body?.data?.length ?? 0;
  ok(status === 200 && count >= MIN_GAMES, {
    ar: 'عدد الألعاب أقل من المتوقع',
    en: `Fewer than ${MIN_GAMES} games`,
    page,
    detail: `HTTP ${status}, ${count} games`,
  });
}

// ─── 3. browser checks ───
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home';

async function screenshot(p, name) {
  const file = `${name}.png`;
  try {
    await p.screenshot({ path: join(OUT, file), fullPage: true, timeout: 15_000 });
    return file;
  } catch {
    return '';
  }
}

/** Navigate, retrying once on a timeout (cold start). Returns the response or throws. */
async function open(p, url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await p.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
      await p.waitForTimeout(900);
      return res;
    } catch (e) {
      if (attempt >= 2 || !/timeout/i.test(String(e))) throw e;
      log(`  timeout on ${url}, retrying once…`);
    }
  }
}

// Layout audit, adapted from the screen-size audit: overflow, text at the edge, digits, lang/dir.
function audit({ w, lang }) {
  const out = { wide: null, edge: [], arabicDigits: '', lang: document.documentElement.lang, dir: document.documentElement.dir, appError: false };
  const doc = document.documentElement;
  if (doc.scrollWidth > w + 1) {
    out.wide = `page is ${doc.scrollWidth}px wide (screen ${w})`;
    for (const e of document.querySelectorAll('body *')) {
      const q = e.getBoundingClientRect();
      if (q.width && (q.right > w + 1 || q.left < -1)) {
        out.wide += ` — first wide: <${e.tagName.toLowerCase()} class="${(e.className?.baseVal ?? e.className ?? '').toString().slice(0, 60)}">`;
        break;
      }
    }
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.textContent.trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || cs.position === 'fixed') continue;
    // inside a horizontal scroller (chips, carousels) the edge is the scroller's, not the screen's
    let skip = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const s = getComputedStyle(a);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && a.scrollWidth > a.clientWidth) { skip = true; break; }
      if (s.position === 'fixed') { skip = true; break; }
    }
    if (skip) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > doc.scrollHeight) continue;
      if (r.left < 8 || r.right > w - 8) {
        seen.add(el);
        out.edge.push(`(${Math.round(r.left)}→${Math.round(r.right)}) "${t.slice(0, 40)}" <${el.tagName.toLowerCase()}>`);
        break;
      }
    }
  }
  const text = document.body.innerText;
  const m = text.match(/.{0,20}[٠-٩۰-۹].{0,20}/);
  if (m) out.arabicDigits = m[0];
  out.appError = text.includes('Application error');
  out.expectDir = lang === 'ar' ? 'rtl' : 'ltr';
  return out;
}

async function newContext(width, lang) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(NAV_TIMEOUT);
  if (lang) await ctx.addCookies([{ name: 'patron_lang', value: lang, url: STORE }]);
  return ctx;
}

log('store pages');
for (const lang of LANGS) {
  for (const width of WIDTHS) {
    const ctx = await newContext(width, lang);
    // browse as a guest ("skip for now" on the sign-in page; otherwise every page
    // redirects to /login), and skip the opening animation so it does not cover
    // the page (checked separately below)
    await ctx.addInitScript(() => {
      try {
        localStorage.setItem('patron_guest', '1');
        sessionStorage.setItem('patron_splash', '1');
      } catch {
        /* storage blocked */
      }
    });
    const p = await ctx.newPage();
    let errors = [];
    p.on('pageerror', (e) => errors.push(e.message));
    for (const path of PAGES) {
      const where = { page: path, width, lang };
      const before = failures.length;
      errors = [];
      let res;
      try {
        res = await open(p, STORE + path);
      } catch (e) {
        fail({ ar: 'الصفحة لم تفتح', en: 'Page did not load', ...where, detail: String(e).split('\n')[0] });
        const shot = await screenshot(p, `store-${lang}-${width}-${slug(path)}`);
        failures.at(-1).shot = shot;
        continue;
      }
      const status = res?.status() ?? 0;
      ok(status > 0 && status < 400, { ar: 'رمز HTTP خاطئ', en: 'Bad HTTP status', ...where, detail: `HTTP ${status}` });
      const a = await p.evaluate(audit, { w: width, lang });
      ok(errors.length === 0, { ar: 'خطأ JavaScript في الصفحة', en: 'JavaScript page error', ...where, detail: errors.join(' | ') });
      ok(!a.appError, { ar: 'رسالة "Application error" ظاهرة', en: '"Application error" shown', ...where });
      ok(!a.wide, { ar: 'الصفحة أعرض من الشاشة', en: 'Page wider than the screen', ...where, detail: a.wide });
      ok(a.edge.length === 0, { ar: 'نص ملاصق لحافة الشاشة', en: 'Text closer than 8 px to the edge', ...where, detail: a.edge.slice(0, 3).join(' · ') });
      ok(!a.arabicDigits, { ar: 'أرقام هندية بدل اللاتينية', en: 'Non-Latin digits in text', ...where, detail: a.arabicDigits });
      ok(a.lang === lang && a.dir === a.expectDir, {
        ar: 'لغة/اتجاه الصفحة خاطئ',
        en: 'Wrong <html lang/dir>',
        ...where,
        detail: `lang="${a.lang}" dir="${a.dir}", expected "${lang}"/"${a.expectDir}"`,
      });

      // page-specific content
      if (path === '/') {
        const n = await p.locator('a[href*="/brands/"]').count();
        ok(n >= 8, { ar: 'شبكة العلامات غير ظاهرة', en: 'Brand grid missing (< 8 brand links)', ...where, detail: `${n} links` });
      }
      if (path === '/brands/g-pubg-mobile') {
        const n = await p.locator('[role="radiogroup"] [role="radio"]').count();
        ok(n > 0, { ar: 'باقات ببجي غير ظاهرة', en: 'PUBG packages missing', ...where, detail: `${n} packages` });
        if (lang === 'ar') {
          const has = await p.getByText('قبل الدفع').first().isVisible().catch(() => false);
          ok(has, { ar: 'نص "قبل الدفع" غير ظاهر', en: '"قبل الدفع" (before paying) text missing', ...where });
        }
      }
      if (path === '/login') {
        const tel = await p.locator('input[type="tel"]').first().isVisible().catch(() => false);
        const wa = /واتساب|WhatsApp/i.test(await p.locator('main').innerText().catch(() => ''));
        ok(tel && wa, { ar: 'حقل رقم واتساب غير ظاهر', en: 'WhatsApp phone field missing', ...where, detail: `tel input: ${tel}, WhatsApp text: ${wa}` });
      }

      if (failures.length > before) {
        const shot = await screenshot(p, `store-${lang}-${width}-${slug(path)}`);
        for (const f of failures.slice(before)) f.shot = shot;
      }
      log(`  ${failures.length > before ? 'FAIL' : 'ok  '} store ${lang} ${width}px ${path}`);
    }
    await ctx.close();
  }
}

// The opening screen: shown on a first visit, gone after 3 s.
log('store opening screen');
{
  const ctx = await newContext(390, 'ar');
  const p = await ctx.newPage();
  const where = { page: '/ (splash)', width: 390, lang: 'ar' };
  const before = failures.length;
  try {
    await p.goto(STORE + '/', { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    const shown = await p.locator('.splash').first().isVisible().catch(() => false);
    ok(shown, { ar: 'شاشة الافتتاح لا تظهر', en: 'Opening screen not shown on first visit', ...where });
    await p.waitForTimeout(3_000);
    const still = await p.locator('.splash').first().isVisible().catch(() => false);
    ok(!still, { ar: 'شاشة الافتتاح لا تختفي', en: 'Opening screen still visible after 3 s', ...where });
  } catch (e) {
    fail({ ar: 'الصفحة لم تفتح', en: 'Page did not load', ...where, detail: String(e).split('\n')[0] });
  }
  if (failures.length > before) {
    const shot = await screenshot(p, 'store-splash');
    for (const f of failures.slice(before)) f.shot = shot;
  }
  await ctx.close();
}

log('store PWA files');
for (const path of PWA_FILES) {
  let status = 0;
  try {
    status = (await fetch(STORE + path, { signal: AbortSignal.timeout(30_000) })).status;
  } catch (e) {
    status = String(e);
  }
  ok(status === 200, { ar: 'ملف التطبيق (PWA) مفقود', en: 'PWA file missing', page: path, detail: `HTTP ${status}` });
}

log('dashboard sign-in page');
{
  const ctx = await newContext(390);
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const where = { page: 'dashboard /login', width: 390, lang: '-' };
  const before = failures.length;
  try {
    const res = await open(p, ADMIN + '/login');
    const status = res?.status() ?? 0;
    ok(status > 0 && status < 400, { ar: 'رمز HTTP خاطئ', en: 'Bad HTTP status', ...where, detail: `HTTP ${status}` });
    const form =
      (await p.locator('form input[type="email"]').first().isVisible().catch(() => false)) &&
      (await p.locator('form input[type="password"]').first().isVisible().catch(() => false)) &&
      (await p.locator('form button[type="submit"], form button:not([type])').first().isVisible().catch(() => false));
    ok(form, { ar: 'نموذج الدخول للوحة غير ظاهر', en: 'Dashboard sign-in form missing', ...where });
    ok(errors.length === 0, { ar: 'خطأ JavaScript في الصفحة', en: 'JavaScript page error', ...where, detail: errors.join(' | ') });
    const appError = (await p.locator('body').innerText().catch(() => '')).includes('Application error');
    ok(!appError, { ar: 'رسالة "Application error" ظاهرة', en: '"Application error" shown', ...where });
  } catch (e) {
    fail({ ar: 'الصفحة لم تفتح', en: 'Page did not load', ...where, detail: String(e).split('\n')[0] });
  }
  if (failures.length > before) {
    const shot = await screenshot(p, 'dashboard-login');
    for (const f of failures.slice(before)) f.shot = shot;
  }
  await ctx.close();
}

await browser.close();

// ─── 4. report ───
// a markdown table cell: backslashes first, then the pipe that would end the cell
const cell = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const MAX_ROWS = 150;
const lines = [
  `# فحص المتجر الحي / Live shop check`,
  '',
  `- المتجر / Store: ${STORE}`,
  `- اللوحة / Dashboard: ${ADMIN}`,
  `- الواجهة البرمجية / API: ${API}`,
  `- الوقت / Time: ${new Date().toISOString()}`,
  '',
  `## النتيجة / Result`,
  '',
  failures.length ? `❌ **${failures.length}** فشل / failed · ✅ **${passed}** نجح / passed` : `✅ كل الفحوص نجحت / all checks passed (**${passed}**)`,
  '',
];
if (failures.length) {
  lines.push(
    `## الإخفاقات / Failures`,
    '',
    '| الفحص / Check | الصفحة / Page | العرض / Width | اللغة / Lang | التفاصيل / Detail | لقطة / Screenshot |',
    '|---|---|---|---|---|---|',
  );
  for (const f of failures.slice(0, MAX_ROWS)) {
    lines.push(`| ${cell(f.ar)} / ${cell(f.en)} | \`${cell(f.page)}\` | ${f.width} | ${f.lang} | ${cell(f.detail)} | ${f.shot ? `\`${f.shot}\`` : ''} |`);
  }
  if (failures.length > MAX_ROWS) lines.push('', `… و${failures.length - MAX_ROWS} أخرى / and ${failures.length - MAX_ROWS} more.`);
  lines.push('', 'اللقطات في مرفقات التشغيل (live-check) / Screenshots are in the run artifact (live-check).');
}
lines.push(
  '',
  `## ما الذي فُحص / What was checked`,
  '',
  `- الواجهة البرمجية / API: rates, stats, manual payment accounts, banners, games (≥ ${MIN_GAMES})`,
  `- المتجر / Store: ${PAGES.join(', ')} × ${WIDTHS.join('/')} px × ${LANGS.join('/')}, opening screen, PWA files`,
  `- اللوحة / Dashboard: /login at 390 px`,
  '',
);
writeFileSync(join(OUT, 'report.md'), lines.join('\n'));
log(`done: ${passed} passed, ${failures.length} failed → ${join(OUT, 'report.md')}`);
process.exit(failures.length ? 1 : 0);
