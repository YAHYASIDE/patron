// Admin API routes that any signed-in user (a customer included) can call.
//
// How the API guards work (apps/api/src/app.module.ts, src/common/guards): JwtAuthGuard and
// PermissionsGuard are global. JwtAuthGuard lets @Public() routes through and requires a valid token
// otherwise; PermissionsGuard reads @RequirePermissions(...) with getAllAndOverride([handler, class]),
// so a method-level decorator replaces the class-level one, and an empty or missing list means
// "any authenticated user". A route under `admin/` therefore needs @RequirePermissions (with at least
// one permission) on the method or its class, or an explicit @Public() (token-guarded webhooks), or a
// @Roles() check if one is ever added.
import { join } from 'node:path';
import { lineIndex, read, rel, walk } from '../lib/fs.mjs';
import { firstString, parseClasses, stripComments } from '../lib/source.mjs';
import { discovery } from '../lib/discovery.mjs';

export const name = 'admin-route-no-permission';

const ROUTE_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'All', 'Head', 'Options', 'Search']);
const GUARDS = new Set(['RequirePermissions', 'Public', 'Roles']);

const trimSlashes = (p) => p.replace(/^\/+|\/+$/g, '');
const joinPath = (a, b) => [trimSlashes(a), trimSlashes(b)].filter(Boolean).join('/');

/** The route path in a decorator's arguments: 'x', ['x', ...] or { path: 'x' }. */
function pathArg(args) {
  if (!args || !args.trim()) return '';
  const objPath = /\bpath\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(args);
  if (objPath) return objPath[2];
  return firstString(args) ?? '';
}

/** 'open' | 'guarded' | 'custom' for a class + method decorator set, following the guards above. */
function protection(classDecorators, methodDecorators) {
  const find = (list, n) => list.find((d) => d.name === n);
  if (find(methodDecorators, 'Public') || find(classDecorators, 'Public')) return 'guarded';
  if (find(methodDecorators, 'Roles') || find(classDecorators, 'Roles')) return 'guarded';
  // method-level @RequirePermissions overrides the class one, even when empty
  const perms = find(methodDecorators, 'RequirePermissions') ?? find(classDecorators, 'RequirePermissions');
  if (perms && /\S/.test(perms.args ?? '')) return 'guarded';
  if (find(methodDecorators, 'UseGuards') || find(classDecorators, 'UseGuards')) return 'custom';
  return perms ? 'empty' : 'open';
}

export function run({ root }) {
  const modules = join(root, 'apps/api/src/modules');
  const files = walk(modules, (p) => p.endsWith('.ts') && !p.endsWith('.spec.ts'));
  const out = [];
  for (const file of files) {
    const src = read(file);
    if (!src.includes('@Controller')) continue;
    const path = rel(root, file);
    const lineOf = lineIndex(src);
    for (const cls of parseClasses(stripComments(src))) {
      const ctrl = cls.decorators.find((d) => d.name === 'Controller');
      if (!ctrl) continue;
      const base = pathArg(ctrl.args);
      for (const method of cls.methods) {
        const route = method.decorators.find((d) => ROUTE_DECORATORS.has(d.name));
        if (!route) continue;
        const full = joinPath(base, pathArg(route.args));
        if (!(full === 'admin' || full.startsWith('admin/'))) continue;
        const state = protection(cls.decorators, method.decorators);
        if (state === 'guarded') continue;
        const verb = route.name === 'All' ? 'ALL' : route.name.toUpperCase();
        const where = `${path}:${lineOf(method.index)}`;
        const custom = state === 'custom';
        const reason =
          state === 'empty'
            ? '@RequirePermissions() بلا أي صلاحية، وهو يعادل عدم وجوده'
            : custom
              ? 'لا يوجد @RequirePermissions ولا @Public، يوجد @UseGuards مخصّص لم يُفحص'
              : 'لا يوجد @RequirePermissions ولا @Public ولا @Roles على الدالة أو الصنف';
        out.push(
          discovery(name, `${verb} /${full}`, {
            kind: 'security',
            title: `مسار إدارة بلا صلاحية: ${verb} /${full}`,
            description:
              `المسار ${verb} /${full} (${cls.name}.${method.name}) تحت admin/ و${reason}. ` +
              'الحارس العام يطلب تسجيل الدخول فقط، فأي حساب مسجّل (حتى حساب زبون) يستطيع استدعاءه.',
            evidence: [
              { type: 'file', ref: where, detail: `${cls.name}.${method.name} → @${route.name}('${pathArg(route.args)}')` },
              { type: 'file', ref: `${path}:${lineOf(ctrl.index)}`, detail: `@Controller('${base}')` },
            ],
            confidence: custom ? 50 : 90,
            verified: !custom,
            severity: custom ? 'MEDIUM' : 'HIGH',
            impact: 'وصول زبون أو موظف بلا صلاحية إلى بيانات أو عمليات الإدارة.',
            proposal: `أضف @RequirePermissions('<الصلاحية المناسبة>') إلى ${cls.name}.${method.name} أو إلى الصنف، مع اختبار يرفض حسابًا بلا صلاحية (403).`,
          }),
        );
      }
    }
  }
  return out;
}
