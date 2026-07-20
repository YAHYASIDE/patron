# Security audit — enterprise readiness review

Conducted as if preparing for an external audit. Each item states the threat,
what was found, and what was done.

**Summary:** 4 issues fixed, 3 accepted risks documented, 11 controls verified
as already correct.

---

## 1. Authorization bypass and privilege escalation

### 1.1 Mass-assignment on user-facing endpoints · **Verified correct**

Threat: a customer sends `{"roleIds": ["<admin-role>"]}` to `PATCH /users/me`
and grants themselves admin.

`UpdateUserDto` has no `roleIds` field, and `forbidNonWhitelisted: true` rejects
the request with a 400 rather than silently dropping the property. Role changes
live only on `AdminUpdateUserDto`, behind `users.write`. Covered by
`auth.e2e-spec` › "strips unknown properties instead of persisting them".

### 1.2 IDOR on order and quote access · **Verified correct**

Every read compares `resource.userId` against the authenticated user before
returning: `OrdersService.findOne`, `QuotesService.findOne`,
`revealResult`. Covered by e2e › "refuses to reveal another customer's code".

### 1.3 Self-privilege operations · **Verified correct**

`setBlocked` and `remove` refuse when `id === actorId`; `super_admin` cannot be
blocked; `super_admin` permissions cannot be edited even by a super admin.

### 1.4 Permission caching · **Verified correct**

Permissions resolve from the database per request rather than being embedded in
the JWT. Revocation is immediate rather than lingering until token expiry.

**Accepted cost:** one query per authenticated request. Measured as negligible
against the alternative of a revoked admin keeping access for 15 minutes.

---

## 2. Injection

### 2.1 SQL injection in reporting · **Fixed**

The reporting module is the only place using raw SQL. Two forms are in use:

- `$queryRaw` tagged templates — parameterised by construction, safe.
- `$queryRawUnsafe` — used in `revenue()` and `profit()` for the date-bucket
  argument.

The bucket is passed as a **bound parameter** (`$3`) to `date_trunc`, not
interpolated, and `bucket()` whitelists it to `day|week|month` regardless.
Two independent controls; either alone would be sufficient.

**Fixed during review:** `productPerformance` interpolated `dto.limit` into
`LIMIT`. It was a validated integer (`@IsInt() @Max(200)`), so not exploitable,
but it was the one place a future edit could have introduced a hole. Now bound.

### 2.2 CSV formula injection · **Fixed**

Threat: a product name of `=HYPERLINK("http://evil.test","Click")` executes when
the finance team opens the export. Genuinely exploited in the wild.

`ReportExportService.escape()` prefixes any cell beginning with `= + - @` tab or
CR with a tab character, neutralising execution while remaining readable.

### 2.3 NoSQL / ORM injection · **Verified correct**

All Prisma filters are built from validated DTO fields. No user-supplied object
is spread into a `where` clause.

---

## 3. Replay attacks

### 3.1 Payment webhook replay · **Verified correct**

Three independent layers:

1. Unique `(source, eventId)` index rejects the duplicate at the database.
2. `markCaptured` uses a conditional `updateMany` on non-terminal statuses.
3. Stripe signatures older than 300 seconds are rejected.

Covered by `payments.webhook.spec` — concurrent captures produce exactly one
`order.paid` event.

### 3.2 Checkout replay · **Verified correct**

`Idempotency-Key` plus conditional quote consumption. Even with the idempotency
layer bypassed, only one request can flip a quote `ACTIVE → CONSUMED`.

### 3.3 Refresh token replay · **Verified correct**

Rotation with reuse detection: presenting an already-rotated token revokes the
entire family and increments `patron_refresh_token_reuse_total`, which is
alerted on.

### 3.4 Provider request replay · **Verified correct**

Deterministic idempotency key from `(itemId, providerId, attemptCount)`. A
timeout followed by a retry returns the provider's original order rather than
buying twice — the highest-cost failure mode in the system.

---

## 4. Timing attacks

### 4.1 Account enumeration via login · **Verified correct**

`login()` runs a bcrypt comparison against a dummy hash when the email does not
exist, so timing and response body are identical either way. Asserted in
`auth.e2e-spec`.

### 4.2 Account enumeration via password reset · **Verified correct**

`forgotPassword` returns an identical response regardless of whether the email
is registered.

### 4.3 Signature comparison · **Verified correct**

Both provider adapters and the Stripe gateway use `crypto.timingSafeEqual` with
a length check first. A naive `===` leaks the signature byte by byte.

### 4.4 OTP verification · **Fixed**

`consumeCode` compared `token.codeHash !== sha256(code)` with `!==`. Both are
fixed-length hex digests of the same length, so the leak is theoretical rather
than practical — but the comparison is now constant-time, because "theoretical"
is not an argument that survives an audit.

### 4.5 Registration timing · **Accepted risk**

`register()` returns faster for an existing email (it short-circuits before
hashing). An attacker can enumerate registered addresses at roughly one query
per attempt.

**Accepted** because the mitigation — always hashing before responding — costs
~100ms on every registration, and the endpoint is rate limited to 5/minute per
IP at the app and 5/minute at nginx. Documented rather than silently left.

---

## 5. Sensitive data exposure

### 5.1 Delivered codes · **Verified correct**

Encrypted at rest (AES-256-GCM), never included in list or detail payloads,
revealed only through a separate audited endpoint. Asserted in e2e: the order
payload must not contain the code string.

### 5.2 Log leakage · **Verified correct**

Redaction configured at the logger covering authorization headers, webhook
signatures, passwords, OTP codes, refresh tokens and every `*Enc` field.
Provider request bodies persist only input *keys*, never values, since those
contain player IDs and emails.

### 5.3 Password hashes · **Verified correct**

Every user read uses an explicit `select`; `passwordHash` appears in no
projection. Asserted in e2e.

### 5.4 Metrics endpoint · **Verified correct** (fixed in phase 3)

Bearer-token guarded; additionally restricted to private ranges at nginx and by
NetworkPolicy in Kubernetes.

### 5.5 Error responses · **Fixed**

`PrismaExceptionFilter` returned `exception.meta.target` in the 409 message,
disclosing internal column names (`users_phone_key`). Now mapped to a
human-readable field name, with the raw constraint logged rather than returned.

---

## 6. Secret management

### 6.1 Secrets in the image · **Verified correct**

`.dockerignore` excludes `.env`, `*.pem`, `*.key`. CI fails the build if a
secret-shaped file is tracked in git. Gitleaks runs on every push.

### 6.2 Secrets in Kubernetes · **Accepted risk, documented**

`00-namespace-config.yaml` ships placeholder values only. A `Secret` manifest is
base64, which is encoding, not encryption — populate from External Secrets
Operator, Vault or SOPS. Called out in the manifest itself so nobody commits
real values into it.

### 6.3 Provider credential rotation · **Verified correct**

`rotateKey` re-encrypts and writes an audit entry. Credentials are never
returned by any endpoint to any role.

### 6.4 Encryption key rotation · **Gap — no mechanism exists**

There is no way to re-encrypt existing ciphertext under a new
`ENCRYPTION_KEY`. If the key is compromised, every stored code, provider key and
2FA secret must be treated as compromised, and there is no rotation path short
of manual re-encryption.

**Recommendation:** add a `keyVersion` column to encrypted fields and a
background re-encryption job. Sized as a small piece of work; flagged because
an auditor will ask, and "we would rotate manually" is not an answer that
survives.

---

## 7. Transaction safety and concurrency

### 7.1 Deadlock on wallet/order · **Fixed** (ADR 010, now Accepted)

Wallet payment and refund acquired the wallet/order pair in opposite orders.
A global lock order — `wallet → order → payment → refund` — is now enforced by
`acquireLocks()`, which sorts by rank so a caller cannot get it wrong, and
sorts by id within a rank so two transactions locking the same *pair* cannot
deadlock either.

`RefundsService.process` now takes the wallet lock unconditionally, even for
card refunds that never touch a balance: a conditional lock is a lock ordering
that depends on data, which is the same bug wearing a disguise.

Covered by `resilience/lock-ordering.spec`.

### 7.2 Lost update on wallet balance · **Verified correct**

`SELECT ... FOR UPDATE` before every read-modify-write, plus a database CHECK
enforcing `balanceAfter = balanceBefore + amount`. Verified under 500 concurrent
operations in `resilience/stress.spec`.

### 7.3 Double fulfilment · **Verified correct**

Conditional claim `WHERE status IN (PENDING, FAILED)`. Two workers handed the
same job cannot both start.

### 7.4 Outbox at-least-once · **Verified correct**

`FOR UPDATE SKIP LOCKED` prevents two relays claiming one event; verified with
six concurrent relays over 200 events.

---

## 8. Denial of service

### 8.1 Report queries · **Fixed** (phase 3)

Date ranges default to 30 days and are capped at 400.

### 8.2 Pagination · **Verified correct**

`limit` capped at 100 (`@Max(100)`); report limits at 200.

### 8.3 Quote flooding · **Accepted risk**

A customer can create unlimited quotes. Each is a few rows and expires in 15
minutes, and the sweeper cleans them up. Rate limited to 120 requests/minute.

**Accepted.** Worth revisiting if quote volume becomes a storage concern.

### 8.4 Request body size · **Verified correct**

Capped at 2MB at nginx; checkout accepts at most 20 line items.

---

## Outstanding items requiring a decision

| Item | Risk | Recommendation |
|---|---|---|
| No encryption-key rotation mechanism | Key compromise has no remediation path | Add `keyVersion` + re-encryption job |
| Registration timing enumeration | Low — rate limited | Accept, or always hash |
| Kubernetes Secret placeholders | Only if someone commits real values | Wire up External Secrets before first deploy |
