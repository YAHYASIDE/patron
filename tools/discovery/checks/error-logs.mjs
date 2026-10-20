// Repeated error lines in a log file (--logs <file>): plain text or JSON lines (pino). Lines are
// grouped by a normalized form (ids, numbers, quoted values, e-mails and URLs blanked), counted, and
// the 20 most frequent groups that occur at least twice become discoveries.
import { basename, isAbsolute, relative, resolve } from 'node:path';
import { read } from '../lib/fs.mjs';
import { scrubText } from '../lib/scrub.mjs';
import { discovery, shortHash } from '../lib/discovery.mjs';

export const name = 'log-error';

const TEXT_ERROR = /\b(?:ERROR|FATAL|CRITICAL|ERR!|Unhandled|UnhandledPromiseRejection)\b|\b[A-Z]\w*(?:Error|Exception)\b|\blevel["']?\s*[=:]\s*["']?(?:error|fatal|50|60)\b/;
const TOP = 20;

/** The message of an error line, or null when the line is not an error. */
export function errorMessage(line) {
  const text = line.trim();
  if (!text) return null;
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text);
      const level = j.level ?? j.severity ?? j.lvl;
      const isError =
        (typeof level === 'number' && level >= 50) || /^(?:error|fatal|critical|err)$/i.test(String(level ?? ''));
      if (!isError) return null;
      const err = j.err ?? j.error ?? {};
      const parts = [j.msg ?? j.message, err.type ?? err.name, err.message].filter((x) => typeof x === 'string' && x);
      return parts.length ? [...new Set(parts)].join(' — ') : text;
    } catch {
      // not JSON after all: fall through to the text rules
    }
  }
  return TEXT_ERROR.test(text) ? text : null;
}

/** The line with everything that varies between occurrences blanked. */
export function normalize(message) {
  return message
    .replace(/^\s*\[?\d{4}-\d{2}-\d{2}[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/, '')
    .replace(/^\s*\[?\d{1,2}:\d{2}:\d{2}(?:\.\d+)?\]?\s*/, '')
    .replace(/https?:\/\/[^\s"'<>]+/g, '{url}')
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '{email}')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '{id}')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/g, '{v}')
    .replace(/\b(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}\b/g, '{id}')
    .replace(/\b0x[0-9a-f]+\b|\b[0-9a-f]{8,}\b/gi, '{hex}')
    .replace(/[+-]?\d+(?:[.,]\d+)*/g, '{n}')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

export function run({ root, logs }) {
  if (!logs) return [];
  const abs = resolve(logs);
  // a path inside the repo as is; anything else by file name only (no runner paths in the report)
  const inRepo = relative(root, abs);
  const shown = inRepo && !inRepo.startsWith('..') && !isAbsolute(inRepo) ? inRepo.split('\\').join('/') : basename(abs);
  const groups = new Map();
  read(abs)
    .split('\n')
    .forEach((line, i) => {
      const msg = errorMessage(line);
      if (!msg) return;
      const key = normalize(msg);
      if (!key) return;
      const g = groups.get(key) ?? { key, count: 0, first: i + 1, sample: msg.slice(0, 300) };
      g.count++;
      groups.set(key, g);
    });
  return [...groups.values()]
    .filter((g) => g.count >= 2)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, TOP)
    .map((g) =>
      discovery(name, shortHash(g.key), {
        kind: 'bug',
        title: `خطأ متكرر ${g.count} مرة: ${scrubText(g.key).slice(0, 90)}`,
        description: `السجل ${shown} يحتوي هذا الخطأ ${g.count} مرة (بعد توحيد المعرّفات والأرقام). السبب الجذري غير معروف بعد.`,
        evidence: [
          { type: 'log', ref: `${shown}:${g.first}`, detail: `${g.count}× ${g.sample}` },
          { type: 'log', ref: `${shown}:${g.first}`, detail: `normalized: ${g.key}` },
        ],
        confidence: 80,
        verified: false,
        severity: g.count >= 100 ? 'HIGH' : g.count >= 10 ? 'MEDIUM' : 'LOW',
        impact: 'خطأ يتكرر في الخادم قد يعني طلبات أو صفحات تفشل للزبائن.',
        proposal: 'افحص أول ظهور في السجل، أعد إنتاج الخطأ باختبار، ثم أصلحه (patron-auto-fixer).',
        testResults: { occurrences: g.count },
      }),
    );
}
