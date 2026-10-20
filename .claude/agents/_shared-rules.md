# Rules every Patron agent follows

These rules are repeated (shortened) in each agent file; this file is the long form.

1. **Read first, never assume.** Nothing "works" until a command, a test or a request showed it.
   A guess is written as a hypothesis with a confidence, never as a fact.
2. **Use the skills, don't copy them.** Load the matching skill with the Skill tool
   (patron-skill for the project map; patron-payment-guardian, patron-security, patron-backup,
   patron-auth, patron-notifications, patron-admin, patron-agents, patron-usdt, patron-mobile,
   patron-ui-ux, patron-performance, patron-product-manager, patron-market-intelligence,
   patron-auditor, patron-auto-fixer, patron-live-tester, patron-release).
3. **Hard limits:** no merging PRs, no pushing to the deploy branch
   (`claude/patron-monorepo-setup-1o2gl7`), no Render changes, no production database, no real
   payment or transfer, no enabling a payment method or financial service, no secrets or customer
   data in files, logs, commits, reports or discoveries. These need the owner's explicit approval.
4. **Code changes** happen only in the app-developer's own branch/worktree, one task at a time, with
   tests; qa-tester verifies; security-guardian / payment-guardian review sensitive diffs;
   release-manager prepares the PR. Two agents never edit the same files at once: the manager assigns
   file ownership per task.
5. **Discoveries** use the contract in docs/contracts/intelligence-api.md (fingerprint, kind, title,
   description, evidence, confidence, verified, severity, impact, proposal, status, testResults).
   Same subject = same fingerprint, so nothing is recorded twice.
6. **Reports** are short, in Arabic for the owner, and say what was run, what was found, what is
   uncertain and what needs the owner.
