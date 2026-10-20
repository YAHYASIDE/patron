// TODO / FIXME / HACK comments in application code (apps/*/src, app, lib). One discovery per file so
// the list stays short; the evidence lists the first few markers.
import { join } from 'node:path';
import { read, rel, subdirs, walk } from '../lib/fs.mjs';
import { discovery } from '../lib/discovery.mjs';

export const name = 'todo-marker';

const CODE = /\.(?:[cm]?[jt]sx?|dart|kt|java|swift|css|scss)$/;
// the marker must sit in a comment: after //, /*, a leading * or #
const MARKER = /(?:\/\/|\/\*|^\s*\*|^\s*#|\{\/\*)[^\n]*?\b(TODO|FIXME|HACK)\b[:(\s]?([^\n]*)/;

export function run({ root }) {
  const out = [];
  for (const app of subdirs(join(root, 'apps'))) {
    for (const part of ['src', 'app', 'lib']) {
      const files = walk(join(root, 'apps', app, part), (p) => CODE.test(p) && !/\.(?:spec|test)\./.test(p));
      for (const file of files) {
        const lines = read(file).split('\n');
        const hits = [];
        lines.forEach((text, i) => {
          const m = MARKER.exec(text);
          if (m) hits.push({ line: i + 1, marker: m[1], text: m[2].replace(/\*\/\s*$/, '').trim().slice(0, 120) });
        });
        if (!hits.length) continue;
        const path = rel(root, file);
        const fixme = hits.some((h) => h.marker !== 'TODO');
        out.push(
          discovery(name, path, {
            kind: 'quality',
            title: `${hits.length} علامة ${[...new Set(hits.map((h) => h.marker))].join('/')} في ${path.split('/').pop()}`,
            description: `ملاحظات عمل غير منتهية في ${path}${fixme ? '، منها FIXME/HACK تشير إلى حلّ مؤقت أو خلل معروف' : ''}.`,
            evidence: hits.slice(0, 5).map((h) => ({ type: 'file', ref: `${path}:${h.line}`, detail: `${h.marker}: ${h.text}` })),
            confidence: 90,
            verified: true,
            severity: 'LOW',
            impact: 'عمل مؤجّل قد يُنسى؛ FIXME/HACK قد يخفي خللًا.',
            proposal: 'حوّل كل علامة إلى مهمة واضحة أو أنجزها واحذفها.',
          }),
        );
      }
    }
  }
  return out;
}
