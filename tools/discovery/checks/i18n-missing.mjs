// Store texts (Arabic keys passed to t / tNow / translate) missing from the French or English
// dictionaries in apps/storefront/lib/i18n/dict, or whose {placeholders} differ. The dictionaries are
// read as data (string literals), never evaluated.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { lineIndex, read, rel, walk } from '../lib/fs.mjs';
import { stripComments, tokenize } from '../lib/source.mjs';
import { discovery } from '../lib/discovery.mjs';

export const name = 'i18n-missing';

const ARABIC = /[؀-ۿ]/;
const KEY_RE =
  /\b(?:t|tNow)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1|\btranslate\(\s*[\w.]+\s*,\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g;
const unescape = (s) => s.replace(/\\(['"`\\])/g, '$1');
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');

/** `{ fr: {...}, en: {...} }` from one dictionary file, reading `'key': 'value'` pairs inside fr/en. */
export function readDictionary(src) {
  const tokens = tokenize(stripComments(src));
  const dict = { fr: {}, en: {} };
  for (let i = 0; i < tokens.length - 2; i++) {
    const t = tokens[i];
    if (!(t.type === 'id' && (t.value === 'fr' || t.value === 'en'))) continue;
    if (tokens[i + 1].value !== ':' || tokens[i + 2].value !== '{') continue;
    const lang = t.value;
    let depth = 0;
    let j = i + 2;
    for (; j < tokens.length; j++) {
      const v = tokens[j];
      if (v.type === 'punct' && v.value === '{') depth++;
      else if (v.type === 'punct' && v.value === '}') {
        depth--;
        if (depth === 0) break;
      } else if (depth === 1 && (v.type === 'str' || v.type === 'id') && tokens[j + 1]?.value === ':') {
        // value: one string or several joined with +
        let k = j + 2;
        let value = '';
        while (tokens[k]?.type === 'str') {
          value += tokens[k].value;
          if (tokens[k + 1]?.value === '+' && tokens[k + 2]?.type === 'str') k += 2;
          else break;
        }
        dict[lang][v.value] = value;
      }
    }
    i = j;
  }
  return dict;
}

export function run({ root }) {
  const store = join(root, 'apps/storefront');
  const dictDir = join(store, 'lib/i18n/dict');
  if (!existsSync(dictDir)) return [];
  const FR = {};
  const EN = {};
  for (const file of walk(dictDir, (p) => /\.[jt]s$/.test(p) && !p.endsWith('index.ts'))) {
    const d = readDictionary(read(file));
    Object.assign(FR, d.fr);
    Object.assign(EN, d.en);
  }
  const files = walk(store, (p) => /\.(?:tsx?|jsx?)$/.test(p) && !/\/(?:i18n|public|scripts)\//.test(`/${rel(store, p)}`));
  const out = [];
  for (const file of files) {
    const src = read(file);
    const code = stripComments(src);
    const lineOf = lineIndex(src);
    const path = rel(root, file);
    const missing = new Map(); // key → { langs: Set, line }
    const broken = new Map();
    for (const m of code.matchAll(KEY_RE)) {
      const key = unescape(m[2] ?? m[4]);
      if (!ARABIC.test(key)) continue;
      const line = lineOf(m.index);
      for (const [lang, dict] of [['fr', FR], ['en', EN]]) {
        if (!(key in dict)) {
          const e = missing.get(key) ?? { langs: new Set(), line };
          e.langs.add(lang);
          missing.set(key, e);
        } else if (placeholders(dict[key]) !== placeholders(key)) {
          const e = broken.get(key) ?? { langs: new Set(), line };
          e.langs.add(lang);
          broken.set(key, e);
        }
      }
    }
    const evidence = (map, label) =>
      [...map].slice(0, 15).map(([key, e]) => ({
        type: 'file',
        ref: `${path}:${e.line}`,
        detail: `${label} (${[...e.langs].join(', ')}): «${key.length > 80 ? `${key.slice(0, 80)}…` : key}»`,
      }));
    if (missing.size) {
      out.push(
        discovery(name, path, {
          kind: 'ux',
          title: `نصوص بلا ترجمة فرنسية/إنجليزية في ${path.split('/').pop()} (${missing.size})`,
          description: `${missing.size} نصًّا عربيًّا في ${path} غير موجود في قواميس lib/i18n/dict، فيظهر بالعربية لمن اختار الفرنسية أو الإنجليزية.`,
          evidence: evidence(missing, 'ناقص'),
          confidence: 95,
          verified: true,
          severity: 'LOW',
          impact: 'زبائن الفرنسية والإنجليزية يرون نصوصًا عربية.',
          proposal: 'أضف المفاتيح الناقصة إلى ملف القاموس المناسب في apps/storefront/lib/i18n/dict (fr و en).',
        }),
      );
    }
    if (broken.size) {
      out.push(
        discovery('i18n-placeholders', path, {
          kind: 'ux',
          title: `ترجمات بمتغيّرات {…} مختلفة في ${path.split('/').pop()} (${broken.size})`,
          description: `${broken.size} ترجمة في القواميس لا تحمل نفس المتغيّرات {name} الموجودة في النص العربي المستخدم في ${path}.`,
          evidence: evidence(broken, 'متغيّرات مختلفة'),
          confidence: 95,
          verified: true,
          severity: 'MEDIUM',
          impact: 'يظهر للزبون نص ناقص (رقم أو اسم مفقود) أو {name} حرفيًّا.',
          proposal: 'صحّح الترجمة لتحمل نفس المتغيّرات.',
        }),
      );
    }
  }
  return out;
}
