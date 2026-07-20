# Operations manual

Everything needed to run Patron in production. Written to be followed at 3am by
someone who did not build it.

**Escalation:** on-call → engineering lead → CTO. Anything touching money that
cannot be resolved in 30 minutes escalates immediately.

---

## 1. Deployment

### Standard release

```bash
git tag v1.4.0 && git push origin v1.4.0     # triggers the pipeline
```

The pipeline runs: lint → type check → migration drift → unit → integration →
e2e → security scans → image build → **staging deploy → load test** →
*manual approval* → backup → migrate → production rollout → verify.

Manual approval on production is deliberate. A deploy that moves money should
have a human on the hook for it.

### What the pipeline does that matters

1. **Backs up before migrating.** A migration without a restore point is a
   decision to accept data loss.
2. **Runs migrations as a Job**, not an initContainer — three replicas racing
   `migrate deploy` is three advisory-lock waits per deploy.
3. **`maxUnavailable: 0`** — capacity never drops during a rollout.
4. **Fails the deploy if `patron_outbox_pending > 100` afterwards.** That means
   committed orders are not reaching workers on the new version, which is worse
   than a failed deploy.

### Manual deploy

```bash
kubectl -n patron delete job patron-migrate --ignore-not-found
kubectl -n patron apply -f deploy/k8s/10-migration-job.yaml
kubectl -n patron wait --for=condition=complete job/patron-migrate --timeout=600s

kubectl -n patron set image deployment/patron-api    api=ghcr.io/ORG/patron:v1.4.0
kubectl -n patron set image deployment/patron-worker worker=ghcr.io/ORG/patron:v1.4.0
kubectl -n patron rollout status deployment/patron-api --timeout=600s
```

---

## 2. Rollback

```bash
kubectl -n patron rollout undo deployment/patron-api
kubectl -n patron rollout undo deployment/patron-worker
```

> **Migrations do not roll back.** Rolling the application back to a version
> that predates a destructive migration will not work. Every migration must be
> backward-compatible with the previous app version:
>
> - Add columns nullable or with a default.
> - **Expand → deploy → contract** across two releases. Never rename or drop in
>   the release that stops using the old name.
> - Never narrow a type in one step.
>
> A migration that breaks this turns a routine rollback into a restore.

**Decision rule:** if the rollback target predates a destructive migration, do
not roll back — fix forward, or restore from the pre-deploy backup and accept
the data loss window. That is a call for the engineering lead, not on-call.

---

## 3. Monitoring

Dashboards, alert rules and scrape config: [`OBSERVABILITY.md`](OBSERVABILITY.md).

### What to look at first, in order

1. **Paid but undelivered** — `GET /admin/reports/failures` → `stuckOrders`.
   Customers have paid and own nothing. Everything else waits.
2. **`patron_outbox_pending`** — if rising, committed orders are not reaching
   workers.
3. **`patron_provider_healthy`** — zero means fulfilment has stopped.
4. **Worker heartbeat age** — stale *with* waiting jobs means a dead or stuck
   worker. Stale with an empty queue at 4am is just a quiet night.
5. **`patron_wallet_drift_count`** — must be zero. Non-zero is a bug, not a
   data-fix.

### Alert severity

| Severity | Meaning | Response |
|---|---|---|
| **P1** | Money is affected: stuck orders, wallet drift, dead outbox | Page immediately |
| **P2** | Degraded: one provider down, queue backlog, stale FX | Respond within 30 min |
| **P3** | Cosmetic or capacity | Next business day |

---

## 4. Incident response

### Standard loop

1. **Acknowledge** and post in the incident channel.
2. **Assess blast radius** — how many orders, how much money, still growing?
3. **Stop the bleeding** before diagnosing. Maintenance mode, disable a
   provider, or scale workers.
4. **Diagnose** using the correlation id. Every response carries one; with
   tracing on, it *is* the trace id.
5. **Communicate** — customers with paid, undelivered orders need to hear from
   you before they open a ticket.
6. **Write it up** within 48 hours. Blameless; the output is an action item, not
   a name.

### Runbook: paid orders not being delivered

```bash
# 1. How bad?
curl -sH "authorization: Bearer $ADMIN_TOKEN" \
  "$API/admin/reports/failures" | jq '.stuckOrders | length'

# 2. Which layer? Outbox, queue, or provider.
curl -sH "authorization: Bearer $METRICS_TOKEN" "$API/metrics" \
  | grep -E 'outbox_pending|queue_depth|provider_healthy'
```

| Symptom | Cause | Action |
|---|---|---|
| `outbox_pending` high, queue empty | Relay is down | Restart workers |
| `outbox_pending` low, queue depth high | Not enough workers | Scale workers |
| Queue empty, orders still stuck | Fulfilment failing silently | Check `provider_calls` |
| `provider_healthy` = 0 | Provider outage | § 5 |

```bash
# 3. Once fixed, replay. Fulfilment is idempotent — this is safe.
kubectl -n patron exec deploy/patron-worker -- \
  node -e "require('./dist/scripts/replay-stuck')"
```

### Runbook: wallet drift detected

**Do not "fix" the balance.** Drift means a write bypassed `WalletService.post()`
— that is a code bug, and correcting the balance destroys the evidence.

```bash
psql "$DATABASE_URL" -c "
  SELECT w.id, w.\"userId\", w.balance AS cached, COALESCE(SUM(t.amount),0) AS ledger
  FROM wallets w LEFT JOIN wallet_transactions t ON t.\"walletId\" = w.id
  GROUP BY w.id HAVING w.balance <> COALESCE(SUM(t.amount),0);"
```

Freeze the affected accounts, find the code path, fix it, then correct balances
via `POST /wallet/adjust` — which is audited.

### Runbook: duplicate charge reported

This should be impossible; treat a genuine case as a P1 with a post-mortem.

```sql
-- Two captured payments on one order
SELECT o."orderNumber", COUNT(p.*) FROM orders o
JOIN payments p ON p."orderId" = o.id AND p.status = 'CAPTURED'
GROUP BY o.id HAVING COUNT(p.*) > 1;

-- Two orders from one quote (must return nothing)
SELECT "quoteId", COUNT(*) FROM orders
WHERE "quoteId" IS NOT NULL GROUP BY "quoteId" HAVING COUNT(*) > 1;
```

Refund immediately via `POST /admin/refunds`, then investigate.

---

## 5. Provider outage

### Detection

`patron_provider_healthy{provider="x"} == 0`, or a rising
`patron_provider_failovers_total`.

**Failover is automatic.** The engine skips unhealthy providers. If a secondary
is configured for the affected products, nothing is required.

### Single provider down, secondary available

Confirm failover is working, then let it run:

```bash
curl -sH "authorization: Bearer $ADMIN_TOKEN" \
  "$API/admin/reports/providers/comparison" | jq '.providers'
```

Watch margin: the secondary is usually more expensive. If the outage runs long,
that is a commercial conversation, not an engineering one.

### Single provider down, no secondary

```bash
# Stop selling the affected products rather than accumulating failed orders.
curl -X PATCH -H "authorization: Bearer $ADMIN_TOKEN" \
  "$API/admin/catalog/products/$PRODUCT_ID" -d '{"isActive": false}'
```

A customer who cannot buy is annoyed. A customer who paid and got nothing is a
refund, a support ticket and a chargeback.

### All providers down

1. Enable maintenance mode (§ 9).
2. Do **not** refund automatically — most orders will fulfil on retry.
3. Once restored, replay stuck orders, then lift maintenance mode.
4. Refund anything still failing after two retry cycles.

### Provider credentials compromised

```bash
# Rotate at the provider first, then here (audited).
curl -X POST -H "authorization: Bearer $ADMIN_TOKEN" \
  "$API/admin/providers/$ID/rotate-key" -d '{"apiKey":"new"}'
```

Review `provider_calls` for the exposure window. If unauthorised purchases are
suspected, deactivate the provider — the engine fails over automatically.

---

## 6. Backup and restore

Full detail in [`DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md). Essentials:

- **RPO 5 minutes, RTO 30 minutes.**
- Three layers: continuous WAL archiving, nightly verified logical dump,
  pre-deploy snapshot.
- Every dump is **verified by restoring it** and comparing row counts.
- Object Lock on the bucket — an attacker with database credentials still
  cannot delete the backups.

> **Restoring without `ENCRYPTION_KEY` gives you orders whose codes, provider
> credentials and 2FA secrets are permanently unreadable.** The key lives in the
> secret manager with its own backup path. Verify it is recoverable separately,
> and test that too. This is the failure mode where the backups all look fine.

### Restore

```bash
kubectl -n patron scale deployment/patron-api --replicas=0
kubectl -n patron scale deployment/patron-worker --replicas=0

pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" backup.dump
psql "$DATABASE_URL" -f deploy/scripts/reconcile.sql    # NOT optional

kubectl -n patron scale deployment/patron-worker --replicas=2
kubectl -n patron scale deployment/patron-api --replicas=3
```

**Reconciliation is not optional.** Between the backup and the restore, payments
may have been captured at the gateway that the restored database knows nothing
about. Those customers have paid and own nothing.

---

## 7. Disaster recovery

See [`DISASTER_RECOVERY.md`](DISASTER_RECOVERY.md) for full scenarios. Quick
reference:

| Scenario | RTO | First action |
|---|---|---|
| Bad migration | 20 min | Scale to zero, restore pre-deploy backup |
| Total database loss | 30 min | Rebuild from base backup + WAL replay |
| Redis loss | 5 min | Restart empty; outbox republishes |
| Region loss | 2 hours | Restore in the secondary region |
| `ENCRYPTION_KEY` loss | **unrecoverable** | See DR §"key compromise" |

Restore drills are **quarterly**. An untested backup is a hope.

---

## 8. Scaling

| Symptom | Scale | Why |
|---|---|---|
| Fulfilment latency rising | Workers | HPA keys on queue depth, not CPU |
| API p95 rising | API pods | HPA on CPU at 65% |
| DB CPU high, connections maxed | PgBouncer | Required past ~8 API pods |
| Reports slow, everything else fine | Read replica | Reports only — never the wallet |

```bash
kubectl -n patron scale deployment/patron-worker --replicas=6
```

**Do not raise fulfilment concurrency above ~10 per pod.** Each job may spend
real money and providers rate-limit. Scale horizontally instead.

---

## 9. Maintenance mode

```bash
# On — blocks checkout, leaves browsing and order history readable.
curl -X PATCH -H "authorization: Bearer $ADMIN_TOKEN" \
  "$API/admin/settings/platform.maintenance_mode" -d '{"value": true}'
```

Deliberately partial: customers can still see orders they have already paid for.
A blanket 503 during a provider outage generates more support load than the
outage does.

**Before enabling:** let in-flight fulfilment drain (`queue_depth{state=active}`
→ 0), or paid orders sit unfulfilled while it is on.

---

## 10. Release checklist

- [ ] Migrations are backward-compatible with the current production version
- [ ] Expand/contract respected — no rename or drop in this release
- [ ] Migration drift check passes (`prisma migrate diff --exit-code`)
- [ ] Unit, integration and e2e green
- [ ] Resilience suite green (nightly, or run manually for risky changes)
- [ ] New endpoints have validation, authorization and rate limits
- [ ] Money-moving endpoints have `@Idempotent()`
- [ ] New queries have supporting indexes; `EXPLAIN` checked
- [ ] New metrics have bounded label cardinality
- [ ] ADR written for any architectural decision
- [ ] `.env.example` updated for new configuration
- [ ] Rollback path confirmed
- [ ] Deploying during business hours with someone available

---

## 11. Production readiness checklist

**Before the first real customer:**

- [ ] Provider adapters verified against sandboxes — **mandatory**
- [ ] FX feed configured and syncing (`patron_fx_rate_age_seconds` healthy)
- [ ] Secrets from a secret manager, not manifests
- [ ] `ENCRYPTION_KEY` backed up separately and its recovery **tested**
- [ ] Backups running and a restore drill completed
- [ ] Alerts routed to a pager someone carries
- [ ] Email and push channels configured (OTP delivery currently fails closed)
- [ ] Payment gateway in live mode, webhooks pointed at production
- [ ] TLS valid, auto-renewing
- [ ] Rate limits tuned against real traffic shape
- [ ] Load test passed at expected peak × 3
- [ ] On-call rota and escalation path agreed
- [ ] This manual read by everyone on it
