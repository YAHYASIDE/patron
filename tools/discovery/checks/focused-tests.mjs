// Focused (`.only`, `fit`) and skipped (`.skip`, `xit`, `xdescribe`) tests. A focused test silently
// turns the rest of its file off in CI; a skipped one hides a behaviour nobody checks any more.
import { join } from 'node:path';
import { lineIndex, read, rel, walk } from '../lib/fs.mjs';
import { firstString, skipBalanced, stripComments } from '../lib/source.mjs';
import { discovery, shortHash } from '../lib/discovery.mjs';

export const name = 'focused-test';

const CODE = /\.(?:[cm]?[jt]sx?)$/;
const TEST_FILE = /\.(?:spec|test|e2e-spec)\.[cm]?[jt]sx?$/;
const PATTERN =
  /(?<![\w.$])(?:(describe|it|test|context|suite)\s*\.\s*(only|skip)|(xit|xdescribe|xtest|xcontext|fit|fdescribe))\s*\(/g;

const isTestFile = (path) => CODE.test(path) && (TEST_FILE.test(path) || /\/(?:test|tests|__tests__)\//.test(path));

export function run({ root }) {
  const files = walk(join(root, 'apps'), (p) => isTestFile(rel(root, p)));
  const out = [];
  for (const file of files) {
    const path = rel(root, file);
    const src = read(file);
    const code = stripComments(src);
    // matched on a copy with string contents blanked, so 'it.only(' inside a string does not count
    const bare = stripComments(src, { blankStrings: true });
    const lineOf = lineIndex(src);
    for (const m of bare.matchAll(PATTERN)) {
      // the test API always takes a name first: `fit(20)` or `function fit(` is a helper
      const open = m.index + m[0].length - 1;
      if (!/^\s*['"`]/.test(code.slice(open + 1, open + 200))) continue;
      const fn = m[1] ? `${m[1]}.${m[2]}` : m[3];
      const focused = m[2] === 'only' || m[3] === 'fit' || m[3] === 'fdescribe';
      const args = code.slice(open + 1, skipBalanced(code, open, '(', ')') - 1);
      const testName = firstString(args.slice(0, 300)) ?? '(unnamed)';
      const line = lineOf(m.index);
      out.push(
        discovery(name, `${path}:${fn}:${shortHash(testName)}`, {
          kind: 'test',
          title: focused ? `اختبار مُركَّز (${fn}) يُخفي بقية الملف: ${testName}` : `اختبار معطّل (${fn}): ${testName}`,
          description: focused
            ? `الملف ${path} يحتوي ${fn}(...)؛ عند تشغيل الاختبارات يُنفَّذ هذا الاختبار وحده وتُتجاهَل بقية اختبارات الملف دون أن يفشل CI.`
            : `الملف ${path} يحتوي ${fn}(...)؛ هذا الاختبار لا يُنفَّذ، فالسلوك الذي يغطيه لم يعد مفحوصًا.`,
          evidence: [{ type: 'test', ref: `${path}:${line}`, detail: `${fn}('${testName}')` }],
          confidence: 95,
          verified: true,
          severity: focused ? 'HIGH' : 'LOW',
          impact: focused ? 'قد تمرّ أخطاء حقيقية لأن معظم اختبارات الملف لا تعمل.' : 'تغطية أقل للسلوك المعني.',
          proposal: focused
            ? `أزل .only/fit من ${path} وشغّل اختبارات الملف كاملة.`
            : `أعد تفعيل الاختبار أو احذفه مع توضيح السبب في ${path}.`,
        }),
      );
    }
  }
  return out;
}
