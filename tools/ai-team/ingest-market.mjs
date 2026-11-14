#!/usr/bin/env node
// Sends market-scout research (docs/markets/<CODE>.json) to the intelligence center:
//   INTEL_API_URL=https://…/api/v1 INTEL_INGEST_TOKEN=… node tools/ai-team/ingest-market.mjs docs/markets/ML.json [...]
// Methods and rules land as PENDING_REVIEW (an existing row keeps the owner's decision). Nothing
// is enabled or linked to an account. Without both env vars it only validates the files.
import { readFileSync } from 'node:fs';

/** The ingest body for one research file: only the `market` block the API accepts. */
export function toIngest(file, research) {
  const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null).map((k) => [k, o[k]]));
  const methods = (research.methods ?? []).map((m) =>
    pick(m, ['key', 'name', 'provider', 'kind', 'currency', 'fees', 'note', 'sources', 'confidence', 'verifiedBy']));
  const rules = (research.rules ?? []).map((r) => pick(r, ['scope', 'ref', 'availability', 'note', 'sources', 'confidence', 'verifiedBy']));
  if (!/^[A-Z]{2}$/.test(research.code ?? '')) throw new Error(`${file}: missing country code`);
  for (const m of methods) if (!m.sources?.length) throw new Error(`${file}: method ${m.key} has no source`);
  return {
    agent: 'market-scout',
    trigger: 'manual',
    status: 'SUCCEEDED',
    summary: `market research ${research.code} (${research.researchedAt ?? 'undated'}): ${methods.length} methods, ${rules.length} rules`,
    market: { code: research.code, methods, rules },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: ingest-market.mjs <research.json> [...]');
    process.exit(64);
  }
  const { INTEL_API_URL: url, INTEL_INGEST_TOKEN: token } = process.env;
  let failed = 0;
  for (const file of files) {
    try {
      const body = toIngest(file, JSON.parse(readFileSync(file, 'utf8')));
      if (!url || !token) {
        console.log(`${file}: valid (${body.market.methods.length} methods, ${body.market.rules.length} rules); not sent: INTEL_API_URL / INTEL_INGEST_TOKEN unset`);
        continue;
      }
      const res = await fetch(`${url.replace(/\/$/, '')}/admin/intelligence/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-intel-token': token },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${text.slice(0, 400)}`);
      console.log(`${file}: sent, HTTP ${res.status} ${text.slice(0, 200)}`);
    } catch (e) {
      failed++;
      console.error(`${file}: ${e instanceof Error ? e.message : e}`);
    }
  }
  process.exit(failed ? 1 : 0);
}
