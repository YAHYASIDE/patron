#!/usr/bin/env bash
# Live check: start every Patron agent with the Claude Code CLI (`claude --agent <name>`) and ask it
# who it is, which skills it loads and what it must never do. Read-only (Edit/Write/Bash denied).
# Needs a logged-in `claude` CLI; costs a few model calls per agent. Usage:
#   tools/ai-team/invoke-agents.sh [out-dir] [agent ...]
set -uo pipefail
cd "$(dirname "$0")/../.."
OUT="${1:-ai-team-invoke}"; shift || true
AGENTS=("$@")
[ ${#AGENTS[@]} -eq 0 ] && AGENTS=(patron-manager market-scout business-analyst security-guardian payment-guardian ux-designer app-developer qa-tester automation-agent customer-experience release-manager)
mkdir -p "$OUT"
PROBE='Load check. Read .claude/agents/_shared-rules.md, then answer with ONE line of JSON only, no prose:
{"agent":"<your agent name>","role":"<your responsibility in one Arabic sentence>","skills":["<skills you load first>"],"never":["<three things you must never do>"],"handoff":["<agents you hand work to>"]}'
for a in "${AGENTS[@]}"; do
  ( claude -p --agent "$a" --max-turns 6 --disallowedTools "Edit,Write,Bash,NotebookEdit" \
      --output-format json "$PROBE" > "$OUT/$a.json" 2> "$OUT/$a.err" ) &
done
wait
pass=0; fail=0
for a in "${AGENTS[@]}"; do
  if node -e '
    const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    const m = /\{[\s\S]*\}/.exec(r.result || ""); if (!m) process.exit(1);
    const j = JSON.parse(m[0]);
    if (j.agent !== process.argv[2] || !j.never?.length) process.exit(1);
    console.log(`ok   ${process.argv[2].padEnd(20)} skills: ${(j.skills||[]).join(", ")}`);
  ' "$OUT/$a.json" "$a" 2>/dev/null; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL $a (see $OUT/$a.json)"; fi
done
echo "agents invoked: $pass ok, $fail failed"
[ "$fail" -eq 0 ]
