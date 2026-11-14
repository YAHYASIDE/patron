---
name: patron-security
description: >-
  Review and harden Patron security: permissions on admin routes, data customers must
  not see, secrets, authentication and sessions, rate limits, uploads, injection, open
  redirects, headers, dependency audit and secret scanning. Use for "security review",
  "ثغرات", "صلاحيات", before releases, and on any change to auth, admin routes,
  uploads or customer-facing serializers.
---

# Patron security

## Model
- Staff routes: `@RequirePermissions('<module>.<action>')`; `super_admin` bypasses
  (common/guards/permissions.guard.ts). Roles: super_admin, admin, finance, support,
  agent (own data only: `agents.self`), customer. Public routes `@Public()`.
- Customer serializers strip staff-only fields: `forCustomer` / `itemForCustomer`
  (orders.service.ts) — adminNote, costs, provider ids, IP/user agent, idempotency keys.
- Errors use one envelope (ADR 019); 403 messages must not leak permission names to
  customers.

## Review procedure
1. **Route matrix**: list every controller route and its guard
   (`grep -rn "@\(Get\|Post\|Put\|Patch\|Delete\)(" apps/api/src/modules`); every `/admin/*`
   route has a permission; customer routes check ownership (`order.userId === userId`).
2. **Leaks**: for each customer endpoint, JSON.stringify the response in an e2e test and
   assert staff-only keys are absent (see `money-flows.e2e-spec.ts`).
3. **Auth**: passwords argon2; refresh tokens hashed and rotated, reuse detection; sessions
   listable/revocable; lockouts per (identifier, IP) so nobody can lock the owner out from
   elsewhere; OTPs hashed, short-lived, attempt-limited; no enumeration on recovery/forgot.
4. **Secrets**: none in code, tests, commits, logs (pino redaction). Run gitleaks:
   `gitleaks git --log-opts="<base>..HEAD"`; settings whose key matches
   secret|password|token|api_key|private never leave the DB (backup filter).
5. **Input**: class-validator DTOs with whitelist + forbidNonWhitelisted; uploads sniffed by
   magic bytes, size-capped; `safeNext()` for redirects (storefront/lib/safe-next.ts);
   raw SQL only via tagged templates.
6. **Headers**: storefront/admin next.config.mjs (frame-ancestors none, nosniff, HSTS,
   referrer policy); API helmet + CORS allow-list (CORS_ORIGINS).
7. **Dependencies**: `npm audit --audit-level=moderate` per app; CI "Security checks" job
   (npm audit, gitleaks, CodeQL).

## Severity
Critical: money or account takeover. High: data leak or privilege escalation. Medium:
abuse/DoS, missing hardening. Low: hygiene.

## Verify this skill worked
Every finding has a failing test or a request that shows it; every fix keeps CI's
"Security checks" green and adds a regression test.
