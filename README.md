# Hydra

Hydra is a desktop app that supervises AI coding agents (Claude Code and Codex CLI). Ask it a question and it answers; ask it for a change and it plans, implements, reviews and verifies the change in isolation, then waits for your approval.

**PLAN → IMPLEMENT → REVIEW → FIX → VERIFY → DEMO → APPROVAL**

- **Isolated changes.** Every change runs in its own git worktree on a `hydra/*` branch. Hydra delivers a task revision only after your approval. Recorded applies offer revert-based rollback, subject to branch state and conflict resolution. Project checks still execute as your user; use trusted repositories.
- **Evidence, not claims.** Hydra runs your project's tests and builds itself (Node, Python, Go, Rust, Java, C/C++, or your own `.hydra/checks.json`), records exit codes against the exact commit, and shows before/after results.
- **Independent review.** A second agent (a different provider when available) reviews the diff together with the real test results. Fix rounds are bounded.
- **Budgets.** Per-task limits on cost, tokens, active time and agent runs.
- **Your accounts, your bill.** Hydra uses *your* locally signed-in Claude Code and Codex CLIs. It never stores, proxies or ships credentials.
- **Your data stays local.** Everything is in a local SQLite database. Remote control from a phone on your network is end-to-end encrypted, and no cloud database is involved.

## Status

**Supervised developer preview.** Historical real-provider and CI evidence is dated in [TEST_EVIDENCE](docs/v2/TEST_EVIDENCE.md); it does not qualify every current build or platform. The [Mission Desk milestone](docs/v2/PRODUCT_MILESTONE.md) simplifies the full desktop product around conversation, a revision-bound receipt and explicit decisions. Signing, public feed/recovery, hostile-code containment, trusted remote bootstrap and broader hardware/accessibility qualification remain release gates. The [full-app distribution and Agensi plan](docs/v2/AGENSI_FULL_PRODUCT.md) separates the Electron application from any standalone companion skill. Nothing has been published by this milestone.

## Develop

Requires Node ≥ 22.13 and git.

```bash
npm install
npm run check      # typecheck, lint, tests, originality check
npm run desktop    # build and launch the desktop app
```

## Licence

Copyright © 2026 Melek Moalla. All rights reserved. No licence is granted until a licence file is added.
