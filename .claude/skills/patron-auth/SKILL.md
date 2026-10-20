---
name: patron-auth
description: >-
  Patron accounts and sign-in: WhatsApp-number sign-in with owner-relayed or provider
  OTP, email or phone with password, email verification codes, password reset,
  support-assisted account recovery, passkeys (fingerprint/face via WebAuthn), sessions
  and devices, brute-force protection. Use for "login", "تسجيل الدخول", "كلمة المرور",
  "استعادة الحساب", "البصمة", sessions, OTP providers, or any change in the auth module.
---

# Patron auth

## Where
API `apps/api/src/modules/auth` (auth.service.ts, token.service.ts, controller, providers for
SMS/email, passkeys, sessions, recovery); store `apps/storefront/app/(shop)/login`, `register`,
`account` (security), `components/AuthGate.tsx`; dashboard `/verifications` (owner-relayed codes)
and `/recovery` (support-assisted recovery).

## Rules
- Passwords: argon2 hashes only. Refresh tokens: SHA-256 hashed, rotated, reuse = revoke the
  family; each device keeps a `sessionId` across rotations (`GET /auth/sessions`, revoke one or all
  others).
- Codes (email/phone/reset/recovery): random 6 digits, stored hashed, short TTL, attempt-limited,
  single use. The owner-relay provider keeps an encrypted copy only so the owner can send it by
  WhatsApp. Codes, passwords and tokens never appear in logs, responses (except the relay page),
  analytics or commits.
- Providers by env: `OTP_PROVIDER` = owner_relay (default) | twilio_verify | capture (tests);
  email via Resend (`RESEND_API_KEY`, `EMAIL_FROM`) or disabled (EMAIL_NOT_CONFIGURED).
- Recovery: staff verify ownership from the request's proof; the system sends a reset code to the
  verified contact; staff never see the code or the password and cannot set one. Audit every step.
- Brute force: failures counted per (identifier, IP) and per IP; a lock blocks that pair, not the
  account everywhere, so nobody can lock the owner out from the owner's own device.
- No account enumeration on forgot-password and recovery (same answer either way).
- Keep the WhatsApp-number flow working: `tests/live/checkout-flow.mjs` and e2e depend on it.
- Passkeys (WebAuthn): only public keys stored; RP id/origin from env (WEBAUTHN_RP_ID,
  STOREFRONT_URL); the button shows only when the browser supports platform authenticators.

## Tests
Unit: auth.service/token.service/providers (nock for Twilio/Resend), lockout properties
(stranger cannot lock owner; pair locks), sessions; e2e: register/login/refresh/revoke; live: sign in
on the local store at 390px.

## Verify this skill worked
All auth tests and the browser checkout flow pass; logs grep clean for codes
(`grep -E "[0-9]{6}"` on a test run's log shows no OTP values).
