// Payment-country risks visible in code and migrations:
//  - a manual transfer account (setting payments.manual_accounts) with empty `countries`, which the
//    store reads as "offered in every country";
//  - a Mauritanian method (Bankily, Masrvi, Sedad, Click/Klic, BIM Bank) listed for a country other
//    than MR ("XX" = every other country), in manual accounts or market payment methods.
// Receiving numbers are never read into the output.
import { basename, dirname, join } from 'node:path';
import { lineIndex, read, rel, walk } from '../lib/fs.mjs';
import { discovery } from '../lib/discovery.mjs';

export const name = 'payment-country';

const MR_METHOD = /\b(bankily|masrvi|sedad|click|klic|bim[\s-]?bank)\b/i;
const FLAT_OBJECT = /\{[^{}]*\}/g;
const field = (obj, key) => {
  const m = new RegExp(`["']?${key}["']?\\s*:\\s*(?:"([^"]*)"|'([^']*)'|(true|false))`).exec(obj);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};
const countriesOf = (obj) => {
  const m = /["']?countries["']?\s*:\s*\[([^\]]*)\]/.exec(obj);
  return m ? [...m[1].matchAll(/["']([A-Za-z]{2})["']/g)].map((x) => x[1].toUpperCase()) : null;
};

/** Manual accounts and market methods in one file: [{ id, method, countries, enabled, index }]. */
function entriesIn(src) {
  const entries = [];
  for (const m of src.matchAll(FLAT_OBJECT)) {
    const obj = m[0];
    const countries = countriesOf(obj);
    const countryCode = field(obj, 'countryCode');
    const looksLikeAccount = countries && /["']?(?:method|accountNumber|kind)["']?\s*:/.test(obj);
    const looksLikeMarketMethod = countryCode && /["']?key["']?\s*:/.test(obj);
    if (!looksLikeAccount && !looksLikeMarketMethod) continue;
    entries.push({
      id: field(obj, 'id') ?? field(obj, 'key') ?? '?',
      method: field(obj, 'method') ?? field(obj, 'name') ?? '',
      countries: looksLikeAccount ? countries : [countryCode.toUpperCase()],
      enabled: field(obj, 'enabled'),
      account: Boolean(looksLikeAccount),
      index: m.index,
    });
  }
  return entries;
}

/** SQL rows `INSERT INTO "market_payment_methods" (...) VALUES ('ML', 'bankily', ...)`. */
function sqlMarketMethods(src) {
  const entries = [];
  for (const stmt of src.matchAll(/INSERT\s+INTO\s+"?market_payment_methods"?\s*\(([^)]*)\)\s*VALUES([\s\S]*?);/gi)) {
    const cols = stmt[1].split(',').map((c) => c.trim().replace(/"/g, ''));
    const ci = cols.indexOf('countryCode');
    const ki = cols.indexOf('key');
    const ni = cols.indexOf('name');
    if (ci === -1 || ki === -1) continue;
    const valuesAt = stmt.index + stmt[0].indexOf(stmt[2]);
    for (const row of stmt[2].matchAll(/\(([^()]*)\)/g)) {
      const vals = [...row[1].matchAll(/'((?:''|[^'])*)'|([^,\s][^,]*)/g)].map((v) => (v[1] ?? v[2]).trim());
      entries.push({
        id: vals[ki],
        method: ni === -1 ? '' : vals[ni],
        countries: [String(vals[ci]).toUpperCase()],
        enabled: undefined,
        account: false,
        index: valuesAt + row.index,
      });
    }
  }
  return entries;
}

/** Migration files, oldest first, from the last one that replaces the whole manual-accounts list. */
function effectiveMigrations(root) {
  const all = walk(join(root, 'apps/api/prisma/migrations'), (p) => p.endsWith('.sql')).sort((a, b) =>
    basename(dirname(a)).localeCompare(basename(dirname(b))),
  );
  let from = 0;
  all.forEach((p, i) => {
    if (/'payments\.manual_accounts'\s*,\s*'\[/.test(read(p))) from = i;
  });
  const replaced = all.slice(0, from).filter((p) => read(p).includes('payments.manual_accounts'));
  return { files: all, skipAccountsIn: new Set(replaced) };
}

export function run({ root }) {
  const { files: migrations, skipAccountsIn } = effectiveMigrations(root);
  const seeds = [
    ...walk(join(root, 'apps/api/src/bootstrap'), (p) => /\.[jt]s$/.test(p)),
    ...walk(join(root, 'apps/api/prisma'), (p) => /\.[jt]s$/.test(p) && !p.includes('/migrations/')),
    ...walk(join(root, 'docs/markets'), (p) => /\.(?:json|[jt]s)$/.test(p)),
  ];
  const out = [];
  for (const file of [...migrations, ...seeds]) {
    const src = read(file);
    if (!/countries|countryCode|market_payment_methods/.test(src)) continue;
    const path = rel(root, file);
    const lineOf = lineIndex(src);
    const isSql = file.endsWith('.sql');
    let entries = [...entriesIn(src), ...(isSql ? sqlMarketMethods(src) : [])];
    // an older migration whose list a later one replaced no longer applies
    if (skipAccountsIn.has(file)) entries = entries.filter((e) => !e.account);
    for (const e of entries) {
      const where = `${path}:${lineOf(e.index)}`;
      const detail = `id=${e.id}${e.method ? ` method=${e.method}` : ''} countries=[${e.countries.join(',')}]${e.enabled !== undefined ? ` enabled=${e.enabled}` : ''}`;
      if (e.account && e.countries.length === 0) {
        out.push(
          discovery(name, `account-all-countries:${e.id}`, {
            kind: 'payment',
            title: `حساب تحويل «${e.method || e.id}» بلا دول (يظهر في كل الدول)`,
            description: `الحساب اليدوي ${e.id} معرّف بقائمة countries فارغة في ${path}؛ المتجر يعرض الحساب الفارغ القائمة في كل الدول.`,
            evidence: [{ type: 'config', ref: where, detail }],
            confidence: 90,
            verified: true,
            severity: 'MEDIUM',
            impact: 'قد يرى زبون في دولة أخرى وسيلة دفع لا يستطيع استخدامها، فيحوّل أموالًا إلى المكان الخطأ أو يتعطّل طلبه.',
            proposal: 'حدّد الدول التي يخدمها الحساب صراحةً من لوحة «وسائل الدفع» (قرار المالك).',
          }),
        );
      }
      const foreign = e.countries.filter((c) => c !== 'MR');
      if (MR_METHOD.test(`${e.id} ${e.method}`) && foreign.length) {
        const label = foreign.map((c) => (c === 'XX' ? 'XX (كل الدول الأخرى)' : c)).join('، ');
        out.push(
          discovery(name, `mr-method-abroad:${e.account ? 'account' : 'market'}:${e.id}`, {
            kind: 'payment',
            title: `وسيلة دفع موريتانية «${e.method || e.id}» مُدرجة لدولة غير موريتانيا: ${label}`,
            description:
              `${e.account ? 'الحساب اليدوي' : 'وسيلة السوق'} ${e.id} يخدم ${label} في ${path}. ` +
              'وسائل الدفع الموريتانية (بنكيلي، مصرفي، سداد، كليك، BIM) تعمل بالأوقية داخل موريتانيا؛ ' +
              'عرضها في دولة أخرى يخالف قاعدة عزل وسائل الدفع لكل دولة. قد يكون ذلك بطلب صريح من المالك، فيلزم تأكيده.',
            evidence: [{ type: e.account ? 'config' : 'file', ref: where, detail }],
            confidence: 85,
            verified: true,
            // MEDIUM, not HIGH: the owner may have asked for it (a person decides)
            severity: 'MEDIUM',
            impact: 'زبون خارج موريتانيا قد يُطلب منه الدفع بوسيلة لا يملكها، فيفشل الطلب أو يحتاج دعمًا يدويًّا.',
            proposal: `راجع مع المالك: إن لم يكن مقصودًا فاحصر ${e.id} في MR من لوحة «وسائل الدفع» (لا يُغيَّر تلقائيًّا).`,
          }),
        );
      }
    }
  }
  return out;
}
