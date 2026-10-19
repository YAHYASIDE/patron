// A customer's order, start to finish, in a real browser against a running API
// and store. Built after a customer could not order at all because their cart
// still held a product the owner had hidden. It walks the cases a real cart
// runs into and fails (exit 1) if any of them blocks the order or shows the
// customer an English or technical message.
//
//   STORE_URL=http://localhost:3002 API_URL=http://localhost:3010/api/v1 \
//   SEED_ADMIN_PASSWORD=… node checkout-flow.mjs
//
// It changes data (hides a product, creates a customer and orders), so it is
// run against a throwaway database in CI, never against the live shop.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const STORE = (process.env.STORE_URL ?? 'http://localhost:3002').replace(/\/$/, '');
const API = (process.env.API_URL ?? 'http://localhost:3010/api/v1').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@patron.io';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, info = '') => {
  results.push({ name, ok: !!ok, info });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${info ? ` — ${info}` : ''}`);
};
const ENGLISH = /unavailable|Not enough stock|maximum \d+ per order|Missing required|Invalid format|Product [0-9a-f-]{36}|Bad Request|Unauthorized/i;
const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082',
  'hex',
);

async function call(path, { method = 'GET', body, token, idem, form } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(form ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(idem ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return data;
}

// ── data: the owner, two real products, one of them hidden after it went into the cart ──
const admin = (await call('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD } })).accessToken;
const find = async (sku) => (await call(`/admin/catalog/products?limit=50&search=${sku}`, { token: admin })).data.find((p) => p.sku === sku);
const keep = await find('TOP-PUBG-60');
const gone = await find('TOP-PUBG-325');
if (!keep || !gone) throw new Error('the starter catalog (TOP-PUBG-60 / TOP-PUBG-325) is missing — run the catalog pack first');
await call(`/admin/catalog/products/${gone.id}`, { method: 'PATCH', token: admin, body: { isActive: false } });

async function customer() {
  const phone = `+2224${String(Date.now()).slice(-7)}`;
  const start = await call('/auth/phone/start', { method: 'POST', body: { phone, fullName: 'زبون فحص الطلب' } });
  await call('/auth/phone/request-code', { method: 'POST', token: start.accessToken, body: {} });
  const code = (await call('/admin/verifications/pending', { token: admin })).find((v) => v.user.phone === phone).code;
  await call('/auth/phone/verify', { method: 'POST', token: start.accessToken, body: { code } });
  const me = await call('/auth/me', { token: start.accessToken });
  return { ...start, id: me.id };
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
async function pageFor(who, cart) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 860 } });
  await ctx.addCookies([{ name: 'patron_lang', value: 'ar', url: STORE }]);
  await ctx.addInitScript(
    ([a, r, c]) => {
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      sessionStorage.setItem('patron_splash', '1');
      localStorage.setItem('patron_access', a);
      localStorage.setItem('patron_refresh', r);
      localStorage.setItem('patron_cart', c);
      localStorage.setItem('patron_currency', 'MRU');
    },
    [who.accessToken, who.refreshToken, JSON.stringify(cart)],
  );
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  return page;
}
const line = (p, qty = 1, player = '5123456789', price = '650') => ({
  productId: p.id, sku: p.sku, nameAr: p.nameAr, unitPrice: price, currency: 'XOF', quantity: qty,
  inputs: [{ key: 'player_id', value: player }],
});
const text = (page) => page.evaluate(() => document.body.innerText);
const shot = (page, name) => page.screenshot({ path: `${OUT}checkout-${name}.png`, fullPage: true });

try {
  // 1 ── a hidden product in the cart, priced in another currency: removed, the rest is ordered by transfer
  const buyer = await customer();
  let page = await pageFor(buyer, [line(gone), line(keep)]);
  await page.goto(`${STORE}/checkout`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /ادفع الآن|متابعة إلى التحويل/ }).waitFor({ timeout: 30_000 });
  let body = await text(page);
  await shot(page, '1-review');
  check('hidden product removed with its name', body.includes(`«${gone.nameAr}» لم يعد متوفرًا`));
  check('no English or technical message', !ENGLISH.test(body), body.match(ENGLISH)?.[0]);
  check('total in ouguiya, nothing left in FCFA', /أوقية/.test(body) && !body.includes('FCFA'));
  check('a payment method is offered', (await page.locator('input[name=gateway]').count()) > 0);
  const cartNow = await page.evaluate(() => JSON.parse(localStorage.getItem('patron_cart')).map((i) => `${i.sku}:${i.currency}`));
  check('the cart keeps only the available product, repriced', cartNow.join() === `${keep.sku}:MRU`, cartNow.join());

  const transfer = page.locator('label', { hasText: 'تحويل' }).first();
  if (await transfer.count()) await transfer.click();
  await page.getByRole('button', { name: /ادفع الآن|متابعة إلى التحويل/ }).click();
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const orderId = new URL(page.url()).pathname.split('/')[2];
  // after "continue to transfer" the methods open by themselves; on a later visit they sit behind a button
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1200);
  const reveal = page.getByRole('button', { name: 'عرض وسائل التحويل' });
  if (await reveal.isVisible().catch(() => false)) await reveal.click();
  await page.getByText('22227268').first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  body = await text(page);
  check('the order page shows where to pay (Bankily 22227268)', body.includes('22227268'));
  await page.locator('input[type=file]').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: /أرسلت المبلغ/ }).click();
  await page.waitForTimeout(2500);
  await shot(page, '2-transfer-sent');
  const pays = await call(`/admin/payments/manual/pending`, { token: admin });
  const mine = (pays.data ?? pays).find((p) => p.orderId === orderId || p.order?.id === orderId);
  check('the transfer reaches the owner with the receipt', !!mine, mine ? '' : 'not in the pending list');
  if (mine) {
    await call(`/admin/payments/${mine.id}/approve`, { method: 'POST', token: admin });
    const order = await call(`/orders/${orderId}`, { token: buyer.accessToken });
    check('approving the transfer pays the order', ['PAID', 'PROCESSING', 'COMPLETED'].includes(order.status) || !!order.paidAt, order.status);
  }
  check('no page errors (transfer)', !page.errors.length, page.errors.join(' | '));
  await page.context().close();

  // 2 ── a malformed player ID: explained in Arabic, with the way back to the cart
  page = await pageFor(buyer, [line(keep, 1, 'abc')]);
  await page.goto(`${STORE}/checkout`, { waitUntil: 'networkidle' });
  await page.getByText('افتح السلّة').waitFor({ timeout: 30_000 }).catch(async () => {
    await shot(page, '3-bad-player-id');
    throw new Error(`no fix link; page says: ${(await text(page)).slice(0, 400).replace(/\s+/g, ' ')}`);
  });
  body = await text(page);
  await shot(page, '3-bad-player-id');
  check('a wrong player ID is explained in Arabic', body.includes('غير صحيح') && !ENGLISH.test(body), body.match(ENGLISH)?.[0]);
  await page.context().close();

  // 3 ── the cart page itself drops the hidden product and says so
  page = await pageFor(buyer, [line(gone), line(keep)]);
  await page.goto(`${STORE}/cart`, { waitUntil: 'networkidle' });
  await page.getByText('لم يعد متوفرًا').first().waitFor({ timeout: 30_000 });
  check('the cart page drops the hidden product with a notice', true);
  await page.context().close();

  // 4 ── paying from the wallet ends on the success screen with the earlier purchase listed
  await call('/wallet/adjust', { method: 'POST', token: admin, body: { userId: buyer.id, currency: 'MRU', amount: 1000, reason: 'فحص الطلب' } });
  page = await pageFor(buyer, [line(keep)]);
  await page.goto(`${STORE}/checkout`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /ادفع الآن|متابعة إلى التحويل/ }).waitFor({ timeout: 30_000 });
  const wallet = page.locator('label', { hasText: 'المحفظة' }).first();
  if (await wallet.count()) await wallet.click();
  await page.getByRole('button', { name: 'ادفع الآن' }).click();
  await page.getByText(/تم استلام طلبك|تم إنشاء طلبك/).waitFor({ timeout: 30_000 });
  body = await text(page);
  await shot(page, '4-wallet-done');
  check('wallet payment completes', body.includes('تم استلام طلبك'));
  check('the success screen lists earlier purchases', body.includes('مشترياتك السابقة'));
  check('no page errors (wallet)', !page.errors.length, page.errors.join(' | '));
  await page.context().close();
} catch (err) {
  check('the flow ran to the end', false, err.message);
} finally {
  await browser.close();
  await call(`/admin/catalog/products/${gone.id}`, { method: 'PATCH', token: admin, body: { isActive: true } }).catch(() => undefined);
}

const failed = results.filter((r) => !r.ok);
writeFileSync(
  `${OUT}checkout-report.md`,
  [
    '# فحص الطلب من أوله لآخره / Checkout flow',
    '',
    `- نجح / passed: ${results.length - failed.length}`,
    `- فشل / failed: ${failed.length}`,
    '',
    ...results.map((r) => `- ${r.ok ? '✅' : '❌'} ${r.name}${r.info ? ` — ${r.info}` : ''}`),
    '',
  ].join('\n'),
);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
