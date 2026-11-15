# CLAUDE.md

Engineering rules for the **Patron** monorepo. These apply to every app and
package unless a directory overrides them locally.

## 0. اللغة: العربية حصرًا (قاعدة دائمة من المالك، 15 نوفمبر 2026)

- كل ما يُكتب للمالك عربي فقط: الردود والشروح والتحليلات والاقتراحات وتقارير
  الإنجاز والأخطاء، ورسائل الإيداع (commit) ووصف طلبات الدمج.
- يبقى بلغته الأصلية فقط ما لا بد منه: الأكواد وأسماء الدوال والمتغيرات والملفات
  والمسارات والروابط والأوامر والمعرّفات التقنية وسطور النسب الآلية في الإيداعات.
- التعليقات الجديدة في الكود تُكتب بالعربية. لا تُعرَّب أسماء موجودة إن كان ذلك
  قد يعطّل التطبيق.
- كل نص جديد يظهر للمستخدم (أزرار، قوائم، عناوين، إشعارات، رسائل خطأ ونجاح،
  نوافذ منبثقة، إعدادات، تقارير، تأكيدات) يُكتب بالعربية أولًا. ترجمات المتجر
  الفرنسية والإنجليزية تبقى لغاتٍ إضافية للزبائن كما قرّر المالك سابقًا.
- استخدم المصطلح العربي كلما أمكن، والأجنبي فقط إن كان اسمًا رسميًا أو كانت
  ترجمته تسبب غموضًا.
- عند انتهاء أي مهمة: ملخص عربي بما عُدِّل وما أُصلح وما تبقّى.

## 1. Repository shape

- Turborepo + npm workspaces. Deployable apps live in `apps/*`, shared code in
  `packages/*`.
- `apps/api` — NestJS backend (Prisma, PostgreSQL, BullMQ).
- `apps/admin` — Next.js (App Router) admin dashboard.
- `apps/storefront` — Next.js (App Router) customer store (Arabic first, French and English).
- `apps/mobile` — Flutter app (built with the Flutter toolchain, outside the
  npm/Turbo graph).
- `packages/tsconfig` — shared TypeScript base configs (`@patron/tsconfig`).
- `packages/types` — shared, framework-agnostic type contracts (`@patron/types`).
- Cross-cutting infra (`deploy/`, `docs/`, root compose) stays at the root.

## 2. Golden rules

- **Structure and configuration only** until a feature is explicitly scoped. Do
  not add business logic to the admin or mobile scaffolds pre-emptively.
- Reuse before you add. Check `packages/*` and existing modules before
  introducing a new dependency or utility.
- Keep changes scoped to one app/package per commit where possible.
- Match the style, naming, and comment density of the surrounding code.

## 3. Tooling & commands

Always drive tasks from the repo root through Turborepo:

```bash
npm run build | dev | lint | lint:check | typecheck | test | format
```

Scope to one workspace with `--workspace=@patron/<name>`. Never bypass the task
runner with ad-hoc scripts that skip lint/type checks.

## 4. TypeScript

- Every TS workspace extends a config from `@patron/tsconfig`
  (`nestjs.json`, `nextjs.json`, or `base.json`). Do not redefine compiler
  options that the shared base already sets.
- `strictNullChecks` and `noImplicitAny` are on everywhere. Do not weaken them.
- The API deliberately does **not** enable full `strict` (NestJS DTOs rely on
  `strictPropertyInitialization` being off). Keep it that way.

## 5. Dependencies & lockfiles

- Dev/CI installs use the **root** `package-lock.json` (npm workspaces).
- Each deployable app (`apps/api`, `apps/admin`) additionally keeps its **own**
  `package-lock.json` so its Docker image builds are self-contained and
  reproducible from that app's build context. When you change an app's
  dependencies, update **both** the root lockfile and the app lockfile.
- Pin dependency ranges the way the surrounding `package.json` already does.

## 6. Database (apps/api)

- Prisma is the single source of truth. Never hand-edit generated client code.
- Schema changes go through `prisma migrate`; commit the generated migration.
- Migrations must not drift from `schema.prisma` — CI's `api-drift` job enforces
  this. Run `npx prisma format` before committing schema changes.
- See `apps/api/DATABASE.md` and `docs/adr/` for data-layer decisions.

## 7. Secrets & config

- Never commit real secrets. `.env.example` files are committed; `.env` files
  are git-ignored. Each app reads its own `.env`.
- No credentials, tokens, or internal hostnames in code, comments, commit
  messages, or CI files.

## 8. Testing & CI

- API: unit / integration / e2e via Jest (see `apps/api/test`). Keep coverage
  thresholds green.
- Admin and storefront: `lint:check`, `typecheck`, and `build` must pass.
- Mobile: `flutter analyze` and `flutter test` must pass.
- Don't merge red. CI runs per-app; a change to one app should not break another.

## 9. Docker

- Every deployable app owns a multi-stage `Dockerfile` that runs as a non-root
  user with a healthcheck. Build contexts are the app directory, not the repo
  root. Keep runtime images minimal (prod deps / standalone output only).

## 10. Commits & PRs

- Clear, imperative commit messages describing the change and its rationale.
- One logical change per PR. Update docs/ADRs when behavior or architecture
  changes.
- Do not open a pull request unless explicitly asked.
