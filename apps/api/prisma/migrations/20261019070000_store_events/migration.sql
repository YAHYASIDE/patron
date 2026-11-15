-- What the shop learns from its visitors (docs/api-contract-feedback.md).
CREATE TABLE "store_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR(20) NOT NULL,
    "value" VARCHAR(300) NOT NULL,
    "detail" JSONB,
    "path" VARCHAR(200),
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "store_events_kind_createdAt_idx" ON "store_events"("kind", "createdAt");

ALTER TABLE "store_events" ADD CONSTRAINT "store_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
