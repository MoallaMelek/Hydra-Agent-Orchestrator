# Hydra

Hydra is a desktop app that supervises AI coding agents (Claude Code and Codex CLI). Ask it a question and it answers; ask it for a change and it plans, implements, reviews and verifies the change in isolation, then waits for your approval.

**PLAN → IMPLEMENT → REVIEW → FIX → VERIFY → DEMO → APPROVAL**

- **Isolated by default.** Every change runs in its own git worktree on a `hydra/*` branch. Your working tree changes only when you press Accept, and every apply can be rolled back with a revert commit.
- **Evidence, not claims.** Hydra runs your project's tests and builds itself (Node, Python, Go, Rust, Java, C/C++, or your own `.hydra/checks.json`), records exit codes against the exact commit, and shows before/after results.
- **Independent review.** A second agent (a different provider when available) reviews the diff together with the real test results. Fix rounds are bounded.
- **Budgets.** Per-task limits on cost, tokens, active time and agent runs.
- **Your accounts, your bill.** Hydra uses *your* locally signed-in Claude Code and Codex CLIs. It never stores, proxies or ships credentials.
- **Your data stays local.** Everything is in a local SQLite database. Remote control from a phone on your network is end-to-end encrypted, and no cloud database is involved.

## Status

**Alpha.** The engine, desktop app and encrypted phone control work and are verified with the real Claude Code and Codex CLIs. CI is green on Windows, macOS and Linux. Not yet released: installers are unsigned and an external beta is pending. See [COMMERCIAL_READINESS](docs/v2/COMMERCIAL_READINESS.md), [USER_GUIDE](docs/v2/USER_GUIDE.md) and [TEST_EVIDENCE](docs/v2/TEST_EVIDENCE.md).

## Develop

Requires Node ≥ 22.13 and git.

```bash
npm install
npm run check      # typecheck, lint, tests, originality check
npm run desktop    # build and launch the desktop app
```

## Licence

Copyright © 2026 Melek Moalla. All rights reserved. No licence is granted until a licence file is added.
