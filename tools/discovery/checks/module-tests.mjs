// API modules that no unit test imports. A module counts as tested when any file under
// apps/api/test/unit references `modules/<name>/`. Placeholder modules (only a *.module.ts, no
// service or controller yet) are left out: there is nothing to test.
import { join } from 'node:path';
import { lineIndex, read, rel, subdirs, walk } from '../lib/fs.mjs';
import { discovery } from '../lib/discovery.mjs';

export const name = 'module-without-unit-test';

/** Files with behaviour: not the module wiring, DTOs, type declarations or barrels. */
const isLogic = (p) =>
  !/\/dto\//.test(p) && !/\.(?:module|dto|d|types?|constants?)\.ts$/.test(p) && !/\/index\.ts$/.test(p);

export function run({ root }) {
  const modulesDir = join(root, 'apps/api/src/modules');
  const unitDir = join(root, 'apps/api/test/unit');
  const tests = walk(unitDir, (p) => /\.[cm]?[jt]s$/.test(p)).map((p) => read(p));
  const out = [];
  for (const mod of subdirs(modulesDir)) {
    const dir = join(modulesDir, mod);
    const files = walk(dir, (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'));
    const logic = files.filter(isLogic);
    if (!logic.length) continue;
    const needle = new RegExp(`modules/${mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`);
    if (tests.some((t) => needle.test(t))) continue;
    const moduleFile = files.find((p) => p.endsWith('.module.ts')) ?? logic[0];
    const src = read(moduleFile);
    const at = src.indexOf('@Module');
    const line = at === -1 ? 1 : lineIndex(src)(at);
    out.push(
      discovery(name, mod, {
        kind: 'quality',
        title: `وحدة API بلا اختبار وحدة: ${mod}`,
        description:
          `لا يوجد أي ملف في apps/api/test/unit يستورد من apps/api/src/modules/${mod}/، ` +
          `مع أن الوحدة تحتوي ${logic.length} ملف منطق (${logic.slice(0, 4).map((p) => rel(root, p).split('/').pop()).join('، ')}${logic.length > 4 ? '…' : ''}).`,
        evidence: [
          { type: 'file', ref: `${rel(root, moduleFile)}:${line}`, detail: `${logic.length} ملف منطق` },
          { type: 'test', ref: `${rel(root, unitDir)}:1`, detail: `لا مرجع إلى modules/${mod}/` },
        ],
        confidence: 90,
        verified: true,
        severity: 'LOW',
        impact: 'تغيير في هذه الوحدة قد يكسر سلوكها دون أن يلاحظه CI.',
        proposal: `أضف apps/api/test/unit/${mod}.service.spec.ts يغطي المسارات الأساسية للوحدة.`,
      }),
    );
  }
  return out;
}
