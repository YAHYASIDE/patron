#!/usr/bin/env node
// Patron Discovery Engine CLI. Read-only on the repository: it only writes the report files you name.
//
//   node tools/discovery/index.mjs [--root .] [--out report.json] [--md report.md]
//        [--logs <file>] [--audit [label=]<npm-audit.json>]... [--trigger manual|schedule|ci] [--ingest]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runDiscovery } from './lib/run.mjs';
import { toMarkdown } from './lib/report.mjs';
import { scrubText } from './lib/scrub.mjs';

const USAGE = `Usage: node tools/discovery/index.mjs [options]
  --root <dir>       repository to scan (default: .)
  --out <file>       write the JSON report here (default: print it to stdout)
  --md <file>        write the Arabic Markdown report here
  --logs <file>      group repeated error lines from this log file
  --audit <file>     an \`npm audit --json\` result; repeatable; "api=<file>" names the app
  --trigger <name>   manual | schedule | ci (default: from the GitHub environment, else manual)
  --ingest           POST the report to \${INTEL_API_URL}/admin/intelligence/ingest
                     with header x-intel-token: \${INTEL_INGEST_TOKEN}
  -h, --help         show this help`;

export function parseArgs(argv) {
  const opts = { root: '.', audits: [], ingest: false };
  const take = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith('--') && a.includes('=') ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a, undefined];
    const value = () => inline ?? take(i++, flag);
    switch (flag) {
      case '--root': opts.root = value(); break;
      case '--out': opts.out = value(); break;
      case '--md': opts.md = value(); break;
      case '--logs': opts.logs = value(); break;
      case '--audit': opts.audits.push(value()); break;
      case '--trigger': opts.trigger = value(); break;
      case '--ingest': opts.ingest = true; break;
      case '-h': case '--help': opts.help = true; break;
      default: throw new Error(`unknown option ${a}`);
    }
  }
  return opts;
}

/** POSTs the report; never prints the token or the URL. Returns true on a 2xx answer or a deliberate skip. */
export async function ingest(report, env = process.env, log = console.error) {
  const base = env.INTEL_API_URL?.trim();
  const token = env.INTEL_INGEST_TOKEN?.trim();
  if (!base || !token) {
    log('ingest skipped: set both INTEL_API_URL and INTEL_INGEST_TOKEN to send the report.');
    return true;
  }
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/admin/intelligence/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-intel-token': token },
      body: JSON.stringify(report),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      log(`ingest failed: HTTP ${res.status} ${scrubText(text.replaceAll(token, '[redacted]')).slice(0, 300)}`);
      return false;
    }
    let body = {};
    try {
      body = JSON.parse(text);
    } catch {
      // a 2xx without JSON still counts as delivered
    }
    log(`ingest ok: HTTP ${res.status}${body.created !== undefined ? `, created ${body.created}, updated ${body.updated}` : ''}`);
    return true;
  } catch (err) {
    log(`ingest failed: ${err instanceof Error ? err.name : 'error'} ${scrubText(err instanceof Error ? err.message : String(err))}`);
    return false;
  }
}

async function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`${err.message}\n\n${USAGE}`);
    return 64;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const report = runDiscovery({
    root: resolve(opts.root),
    logs: opts.logs,
    audits: opts.audits,
    trigger: opts.trigger,
  });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (opts.out) writeFileSync(resolve(opts.out), json);
  else process.stdout.write(json);
  if (opts.md) writeFileSync(resolve(opts.md), `${toMarkdown(report)}\n`);
  console.error(`discovery: ${report.status}, ${report.summary}`);
  const delivered = opts.ingest ? await ingest(report) : true;
  if (report.status !== 'SUCCEEDED') return 1;
  return delivered ? 0 : 2;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) process.exitCode = await main(process.argv.slice(2));
