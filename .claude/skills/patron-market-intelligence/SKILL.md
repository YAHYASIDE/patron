---
name: patron-market-intelligence
description: >-
  Patron markets per country: research a country's payment methods, currency, languages
  and phone format from official sources, record them as PENDING_REVIEW with sources and
  a verification date, keep every country's options isolated (no Mauritanian Bankily or
  Masrvi for Mali), product availability per country (region-locked gift cards, currency,
  delivery), staleness checks, and the owner's approve / reject / defer flow. Use for
  "add a country", "إضافة دولة", "وسائل الدفع في مالي", "السوق", "Orange Money", "Moov",
  "Wave", market research, or the "فرص التطوير والاكتشافات" dashboard. Nothing is ever
  activated automatically.
---

# Patron market intelligence

Read `patron-skill` first, and `patron-payment-guardian` before touching payments. The
API contract is `docs/contracts/intelligence-api.md`; the models are the
"MARKETS & INTELLIGENCE" section of `apps/api/prisma/schema.prisma` (migration
`20261022000000_markets_intelligence`).

## 1. The model in one screen

| Thing | Where | Who changes it |
|---|---|---|
| Country (code, names ar/fr/en, currency + accepted currencies, languages, dial code, enabled) | `market_countries` | owner (`markets.manage`). A new country starts **disabled** |
| Payment method known to exist in a country (Orange Money Mali, Moov Money Mali, Wave Sénégal…) | `market_payment_methods`, unique (country, key) | research writes facts; owner decides |
| Product rule for a country (a `-US-` gift card needs a US account, a brand not sold there…) | `product_market_rules`, unique (country, scope, ref) | research writes; owner decides |
| Where the customer's money actually goes | `payments.manual_accounts` (system setting, `countries[]`) | **owner only**, in /payment-methods |

A market method is knowledge, not an account. A customer only ever sees a payment option that is
a **usable manual account** (enabled + number) whose `countries` include their region. The market
layer never creates, enables or edits an account.

## 2. Lifecycle of a method (never skip a step)

```
research → PENDING_REVIEW ──approve──> APPROVED ──link-account──> ACTIVE
                 │  └─defer──> DEFERRED (back to review later)
                 └─reject──> REJECTED
```

- `link-account` succeeds only if the method is APPROVED **and** the chosen account exists, is
  usable and lists this country. Errors: `METHOD_NOT_APPROVED`, `ACCOUNT_NOT_USABLE`,
  `ACCOUNT_OTHER_COUNTRY`.
- Re-research (upsert by country + key) refreshes facts, sources and `lastVerifiedAt` but keeps the
  status and the owner's decision. A research run can never move a method to APPROVED or ACTIVE.
- No step moves money, enables an account or changes prices.

## 3. Country isolation (the Mali rule)

- Each account carries `countries[]`. A Mali customer (region `ML`) sees only accounts listing `ML`
  (or `XX` for "other countries" when ML is not served). Bankily / Masrvi / Sedad / Click are
  Mauritanian (`MR`) and must never list `ML`.
- An account with **empty** `countries` serves everyone. That is legacy behaviour and a risk: the
  `payments-by-country` scanner reports it, and the owner should give every account a country.
- Changing a customer's region changes the options offered for **new** orders only. Orders, quotes
  and payments already created keep their currency, amounts and method (they are frozen rows).

## 4. Researching a country (market-scout procedure)

1. Facts to collect: ISO code, names (ar/fr/en), official currency and other accepted currencies,
   languages, dial code and the national number format, then each payment method: key
   (`orange-money-ml`), name, provider, kind (`mobile` | `bank` | `card` | `crypto` | `cash`),
   currency, documented fees (or "unknown"), and how a merchant **receives** money with it.
2. Sources, in this order of trust: the provider's own site for that country (orange.ml,
   moov-africa.ml, wave.com), the central bank / regulator (BCEAO for the UEMOA zone, Banque
   Centrale de Mauritanie), then reputable press. Never a forum or an AI summary.
3. Every fact keeps its sources: `{ url, title, publisher, accessedAt }`. A method with no source is
   not recorded.
4. `confidence` 0–100 is honest: 90+ only for the provider's own page; a fee read from a reseller is
   at most 50. Anything not confirmed is written as unconfirmed, never as a fact.
5. Output the ingest JSON (contract §Intelligence, `market: { code, methods, rules }`) and post it
   with `POST /admin/intelligence/ingest`, or hand it to the owner. Methods land as PENDING_REVIEW.
6. Product availability: for every brand sold in the country, check whether the product can be used
   there (store region, card region, provider coverage). Record a rule with `availability`
   `AVAILABLE | UNAVAILABLE | REGION_ACCOUNT_REQUIRED | UNKNOWN` and a short note the store can show.

Worked example, Mali (`ML`, XOF, French, +223, 8-digit numbers): Orange Money Mali and Moov Money
Mali are the main mobile-money methods (verify on orange.ml and moov-africa.ml at research time;
record fees only if the provider publishes them). They go in as PENDING_REVIEW. They reach
customers only after the owner approves them **and** adds a receiving account for `ML` in
/payment-methods and links it. Bankily and Masrvi are never shown in Mali.

## 5. Staleness and periodic checks

- A method or rule whose `lastVerifiedAt` is older than `markets.stale_days` (default **90**) is
  stale. The `market-staleness` scanner raises a discovery; the admin shows "يحتاج إعادة تحقق".
- An enabled country never researched (`lastResearchedAt` null) is also reported.
- Every scanner run stores an `AgentRun` (agent, status, summary, startedAt, finishedAt) so the
  admin shows the last result and its date, and warns when a scanner has not run for 2 days.

## 6. Discoveries ("فرص التطوير والاكتشافات")

A discovery is `{ fingerprint, kind, title, description, evidence[], confidence, verified,
severity, impact, proposal, status, testResults? }`, upserted by fingerprint (deduped; a DONE or
REJECTED one is never reopened automatically). Kinds used here: `market` (country research needed,
missing payment for an enabled country), `payment` (account serving every country, method linked
to an unusable account), `catalog` (region-locked product without a rule), `opportunity` (search
gaps). Never put phone numbers, account numbers, emails, tokens or customer data in a discovery.

## 7. Adding a new country (checklist)

1. `POST /admin/markets` (disabled) → a `market.research-needed:<code>` discovery appears.
2. Research (§4) → ingest → methods and rules PENDING_REVIEW.
3. Owner reviews in /markets: approve / reject / defer each one.
4. Owner adds the currency in /currencies if new, and a receiving account for the country in
   /payment-methods.
5. Link the account to the approved method → ACTIVE.
6. Owner enables the country. The store reads `GET /markets` (falls back to its static list).

## 8. Verify (before saying "done")

From `apps/api`: `npx jest --config test/jest-unit.json markets intelligence` and the integration
suite with a throwaway database. Check by hand that:

- an ML customer never sees an MR-only account (the store filters the public account list with
  `servesRegion` in `apps/storefront/lib/regions.ts`; region comes from the chosen country or the
  WhatsApp number's dial code, `XX` = every other country);
- ingesting the same research twice keeps the owner's decision;
- `link-account` refuses a non-approved method, a disabled account and an account of another country;
- old orders still show their original currency and method after a country or account change.
