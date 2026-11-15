# Sprint 1 — Identity & Access Layer

**Status:** complete
**Scope:** authentication, users, roles, permissions (RBAC), audit logging, and
account security for the Patron API (`apps/api`).

This sprint delivered the complete Identity & Access layer. A substantial part
of the layer already existed from earlier scaffolding; this sprint **hardened
password hashing to Argon2id**, **closed the audit-logging gaps for login/logout**,
added **unit tests**, and **completed the Swagger documentation**. Nothing was
rebuilt that already worked — the existing architecture (global guards, ALS
request context, centralised `AuditService`, transactional writes) was reused
throughout.

---

## 1. Authentication

| Capability | Endpoint | Notes |
| --- | --- | --- |
| Register | `POST /auth/register` | Creates user + customer role + default wallet in one transaction; issues an email-verification code. |
| Login | `POST /auth/login` | Argon2id verification; records a `LoginAttempt`; audited as `auth.login`. |
| Refresh (rotation) | `POST /auth/refresh` | Issues a new pair, revokes the old token; **reuse of a rotated token revokes the whole family**. |
| Logout | `POST /auth/logout` | Revokes the presented refresh token; audited as `auth.logout`. |
| Logout everywhere | `POST /auth/logout-all` | Revokes all sessions; audited as `auth.logout_all`. |
| Profile | `GET /auth/me` | Roles + wallet balances; never returns a hash. |
| Change password | `POST /auth/change-password` | Requires current password; revokes all sessions. |

### JWT access tokens
- Stateless, signed with `JWT_ACCESS_SECRET`, `type: 'access'` claim, short TTL
  (`JWT_ACCESS_TTL`, default `15m`).
- **Roles/permissions are resolved per request in `JwtStrategy.validate`, not
  embedded in the token** — a revoked permission or blocked account takes effect
  immediately rather than lingering until expiry.

### Refresh-token rotation
- Refresh tokens are opaque random strings; only their **SHA-256 digest** is
  stored (`RefreshToken.tokenHash`), so a DB leak cannot be replayed.
- On refresh the old token is revoked and a new one issued. Presenting an
  already-revoked token is treated as theft: `revokeAllForUser` fires and a
  `tokenReuseDetected` metric is incremented.

### Password hashing — Argon2id (new this sprint)
- `CryptoService.hashPassword` now uses **Argon2id** via `@node-rs/argon2`
  (prebuilt musl+gnu binaries — no node-gyp; works in the Alpine runtime image),
  with OWASP-aligned defaults (`m=19456 KiB, t=2, p=1`).
- **Backward compatible:** `verifyPassword` routes by hash prefix — Argon2 for
  `$argon2*`, bcrypt for `$2*` — so pre-existing bcrypt hashes keep working.
- **Transparent migration:** on the next successful login, a legacy bcrypt hash
  is re-hashed to Argon2id (`passwordNeedsRehash`) and stored. No password reset
  is forced on any user.
- **No timing oracle:** an unknown email runs `fakeVerify` against a fixed valid
  Argon2 hash, so "account not found" costs the same as "wrong password".
- The database seed now hashes the bootstrap admin with Argon2id as well.

---

## 2. Users

| Capability | Endpoint | Permission |
| --- | --- | --- |
| My profile (read/update) | `GET/PATCH /users/me` | authenticated only |
| List / read | `GET /users`, `GET /users/:id` | `users.read` |
| Create | `POST /users` | `users.write` |
| Update (admin) | `PATCH /users/:id` | `users.write` |
| Enable/disable (block) | `PATCH /users/:id/block` | `users.block` |
| Soft delete | `DELETE /users/:id` | `users.write` |

- **Profile self-service** (`/users/me`) cannot touch roles or status.
- **Enable/Disable:** blocking flips `isBlocked` **and revokes all live
  sessions**; super admins cannot be blocked; you cannot block or delete
  yourself.
- **Soft delete** sets `deletedAt` + `isActive=false`, revokes sessions, and is
  refused while the user has open orders.
- Every admin mutation writes a redacted before/after audit row.

---

## 3. Roles

| Capability | Endpoint | Permission |
| --- | --- | --- |
| List / read | `GET /roles`, `GET /roles/:id` | `roles.manage` |
| Create custom role | `POST /roles` | `roles.manage` |
| Update (description + permissions) | `PATCH /roles/:id` | `roles.manage` |
| Delete custom role | `DELETE /roles/:id` | `roles.manage` |

- **System roles** (`isSystem=true`, installed by the seed: `super_admin`,
  `admin`, `support`, `finance`, `customer`) cannot be deleted;
  `super_admin` permissions cannot be modified.
- **Custom roles** are created with `isSystem=false` and an arbitrary permission
  set (validated against the catalogue).
- A role still held by users cannot be deleted.

---

## 4. Permissions (RBAC)

- **Permission entities** are a fixed catalogue owned by the codebase and
  installed by the seed — there is deliberately **no create/update/delete API**,
  so the guards and the database cannot drift. Read via
  `GET /permissions` (grouped by module).
- **Role↔Permission mapping** via `RolePermission`; managed through the roles API.
- **User↔Role mapping** via `UserRole`; managed through the users API.
- **Guards** (registered globally in `AppModule`, in order):
  `ThrottlerGuard → JwtAuthGuard → PermissionsGuard`.
- **Decorators:**
  - `@Public()` — opt a route out of auth.
  - `@RequirePermissions('a', 'b')` — requires **all** listed keys.
  - `@CurrentUser()` — inject the resolved `AuthUser`.
- `super_admin` bypasses the permission matrix by design.

---

## 5. Audit logging

Centralised through `AuditService` (auto-attaches request IP/correlation id and
**redacts** `passwordHash`, `*Enc`, `tokenHash`, `codeHash`). Actions recorded:

| Event | Action | Added this sprint |
| --- | --- | --- |
| Register | `auth.register` | existing |
| **Login** | `auth.login` | ✅ new |
| **Logout** | `auth.logout` | ✅ new |
| **Logout all** | `auth.logout_all` | ✅ new |
| Password change | `auth.password_change` | existing |
| Password reset | `auth.password_reset` | existing |
| User create/update/block/unblock/delete | `users.*` | existing |
| Role create/update/delete (permission changes) | `roles.*` | existing |

Failed logins are additionally captured in the dedicated `LoginAttempt` table
(used by the lockout logic), separate from the audit log.

---

## 6. Security

- **Rate limiting** — tiered `ThrottlerModule` with tight per-route overrides:
  register 5/min, login 10/min, forgot-password 3 per 5 min, reset 5 per 5 min.
- **Account lockout** — `assertNotLockedOut` blocks login (HTTP 403) after
  `SECURITY.maxLoginAttempts` (default 5) failures by **identifier or IP** within
  `lockoutMinutes` (default 15).
- **Email-verification framework** — `VerificationToken` (hashed 6-digit codes,
  TTL, attempt cap, single live code per purpose); `POST /auth/verify-email`.
  Code delivery is a documented hand-off point to the notifications module.
- **Password-reset framework** — `POST /auth/forgot-password` (enumeration-safe,
  identical response regardless of account existence) → `POST /auth/reset-password`
  (consumes the code, revokes all sessions).
- Codes/tokens are stored as SHA-256 digests and compared in constant time.

---

## 7. Testing

New unit suites (all green; 65 tests total):

- `test/unit/crypto.service.spec.ts` — Argon2id hashing/verification, legacy
  bcrypt verification, `passwordNeedsRehash`, `fakeVerify`, malformed-hash safety.
- `test/unit/auth.service.spec.ts` — login success + audit, bcrypt→Argon2
  rehash-on-login, no-rehash for Argon2, invalid credentials, constant-time
  fake-verify for unknown emails, lockout, blocked account, logout + logout-all
  auditing.

Existing e2e coverage (`test/e2e/auth.e2e-spec.ts`) continues to exercise
registration, enumeration-safe login, lockout, rotation/reuse, session
invalidation on password change, and hash-leak prevention.

```
lint      ✅  eslint --max-warnings=0
test:unit ✅  9 suites, 65 tests
build     ✅  nest build
```

> Integration/e2e run in CI (they require Postgres + Redis); no Docker daemon is
> available in the authoring sandbox.

---

## 8. Swagger

- `@ApiOperation` + `@ApiResponse` on every auth/users/roles/permissions
  endpoint; `@ApiProperty`/`@ApiPropertyOptional` on all identity DTOs (with
  examples and constraints).
- Bearer auth is declared globally (`DocumentBuilder().addBearerAuth()`); the
  spec is served at `GET /docs`.

---

## 9. Files touched

- `common/crypto/crypto.service.ts` — Argon2id + legacy verify + rehash + fake verify.
- `modules/auth/auth.service.ts` — login/logout/logout-all audit, rehash-on-login, fake verify.
- `modules/auth/auth.controller.ts`, `modules/auth/dto/auth.dto.ts` — Swagger + pass request meta to logout.
- `modules/users/*`, `modules/roles/*`, `modules/permissions/*` — Swagger annotations.
- `prisma/seed.ts` — Argon2id for the bootstrap admin.
- `package.json` (+ root & app lockfiles) — add `@node-rs/argon2`.
- `test/unit/{crypto.service,auth.service}.spec.ts` — new suites.

No Prisma schema or migration changes were required — the identity tables
(`User`, `Role`, `Permission`, `UserRole`, `RolePermission`, `RefreshToken`,
`VerificationToken`, `LoginAttempt`, `AuditLog`) already existed.
