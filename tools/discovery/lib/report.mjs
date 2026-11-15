// The Arabic Markdown report for the owner (and the GitHub job summary).
import { SEVERITIES, countBySeverity } from './discovery.mjs';

const SEVERITY_AR = { CRITICAL: 'حرج', HIGH: 'عالٍ', MEDIUM: 'متوسط', LOW: 'منخفض', INFO: 'معلومة' };
const TRIGGER_AR = { manual: 'يدوي', schedule: 'مجدول', ci: 'CI', app: 'التطبيق' };

// keep the text inert in GitHub's renderer: no raw HTML, no table breaks
const esc = (s) => String(s ?? '').replace(/[<>]/g, (c) => (c === '<' ? '&lt;' : '&gt;')).replace(/\r?\n/g, ' ');
const code = (s) => `\`${String(s).replace(/`/g, "'")}\``;

export function toMarkdown(report) {
  const counts = countBySeverity(report.discoveries);
  const lines = [];
  lines.push('# تقرير محرّك الاكتشاف — Patron', '');
  lines.push(
    `- **الحالة:** ${report.status === 'SUCCEEDED' ? 'نجح' : 'فشل جزئيًّا'} (${esc(report.status)})`,
    `- **التشغيل:** ${TRIGGER_AR[report.trigger] ?? esc(report.trigger)}`,
    ...(report.branch ? [`- **الفرع:** ${code(report.branch)}`] : []),
    ...(report.commit ? [`- **الإيداع:** ${code(report.commit.slice(0, 12))}`] : []),
    `- **الملخّص:** ${esc(report.summary)}`,
    '',
  );
  lines.push('## العدد حسب الخطورة', '', '| الخطورة | العدد |', '|---|---|');
  for (const s of SEVERITIES) lines.push(`| ${SEVERITY_AR[s]} (${s}) | ${counts[s]} |`);
  lines.push(`| **المجموع** | **${report.discoveries.length}** |`, '');

  if (!report.discoveries.length) {
    lines.push('لا توجد اكتشافات في هذا التشغيل.', '');
    return lines.join('\n');
  }
  lines.push('## الاكتشافات', '');
  report.discoveries.forEach((d, i) => {
    lines.push(`### ${i + 1}. [${SEVERITY_AR[d.severity]}] ${esc(d.title)}`, '');
    lines.push(
      `- **المعرّف:** ${code(d.fingerprint)} — **النوع:** ${esc(d.kind)}`,
      `- **الثقة:** ${d.confidence}% — ${d.verified ? '«مؤكد»' : '«تقدير»'}`,
      `- **الوصف:** ${esc(d.description)}`,
      `- **الأثر:** ${esc(d.impact)}`,
      `- **المقترح:** ${esc(d.proposal)}`,
      '- **الأدلة:**',
      ...d.evidence.map((e) => `  - ${esc(e.type)} ${code(e.ref)}${e.detail ? ` — ${esc(e.detail)}` : ''}`),
      '',
    );
  });
  return lines.join('\n');
}
