---
name: patron-ai-team
description: >-
  Run the Patron AI development team: turn a discovery or an owner request into a task with one
  owner agent and its files, then app-developer (own branch, tests first) → qa-tester → security-
  guardian / payment-guardian for sensitive diffs → release-manager (PR, never merge), and record
  the result in the intelligence center. Use for "فريق الوكلاء", "وزّع المهمة", "شغّل الوكلاء",
  "اعتمد الإصلاح", fixing an approved discovery, or checking that the agents still load.
---

# Patron AI team — how to run it

Read `patron-skill` first. The agents are `.claude/agents/*.md` (11 roles, shared limits in
`.claude/agents/_shared-rules.md`); the owner's guide is `docs/AI_TEAM_GUIDE.md`.

## 1. Facts that do not change

- Agents run **only when started** (a Claude Code session, the Agent tool, or
  `.github/workflows/intelligence.yml`). Nothing runs continuously; never say otherwise.
- Only `app-developer`, `qa-tester` and `automation-agent` may edit files. Everyone else reads.
- No agent merges, pushes to `claude/patron-monorepo-setup-1o2gl7`, touches Render or production,
  moves money or enables a payment method. Those wait for the owner.

## 2. One task, end to end (the INTEL-001 pattern)

| Step | Agent (`subagent_type`) | Gets | Returns |
|---|---|---|---|
| 1 Plan | `patron-manager` | discoveries / request | task id, owner agent, files, acceptance test |
| 2 Build | `app-developer` (worktree isolation) | task id, branch `claude/<task-id>-<slug>`, files, gates | branch + commits, failing-test-first proof, gate counts |
| 3 Verify | `qa-tester` | branch, worktree path | PASS/FAIL, counts, HTTP codes, coverage gaps |
| 4 Review | `security-guardian` (auth, admin routes, uploads) / `payment-guardian` (money) | diff range | APPROVE / CHANGES REQUESTED, findings by severity |
| 5 Ship | `release-manager` | evidence from 2–4 | readiness, PR body file; never merges |
| 6 Record | orchestrator | — | ingest with `testResults`, `branch`, `prUrl`; decision `start` |

Rules: two tasks never share a file at the same time (the manager assigns files); a task that
touches the global guard, payments or migrations always gets step 4; rebase on the latest base and
re-run the gates before step 5; a red CI after the PR is the developer's to fix.

## 3. Recording in the intelligence center

Post the same fingerprint again through `POST /admin/intelligence/ingest` with
`testResults` (passed, failed, suites, qa, security), `branch` and `prUrl`: the row keeps the
owner's decision, counts the sighting and shows the results. The owner marks it «تم» after merge.
Never put tokens, account numbers or customer data in `testResults`.

## 4. Checks (run after changing any agent or skill)

```bash
node tools/ai-team/check-agents.mjs            # static: 11 agents, tools, skills exist, limits linked
node --test tools/discovery/test/*.test.mjs tools/ai-team/test/*.test.mjs
tools/ai-team/invoke-agents.sh <out-dir>       # live: each agent answers as itself (model calls)
```

On Node 22 `node --test <dir>` fails; always pass the `*.test.mjs` globs.

## 5. Gotchas learned

- A worktree's `node_modules` is a symlink to the main checkout: if the main checkout regenerates
  the Prisma client from a newer schema, the worktree's integration tests fail on columns it does
  not have. Generate the client from the worktree's own schema or rebase first.
- Agents defined in `.claude/agents` load in a **new** session; the session that created them only
  sees them after a restart (use `general-purpose` with "adopt .claude/agents/<name>.md" meanwhile).
- `pkill -f` / `pgrep -f` can kill the agent's own shell: kill by the PID you started.
