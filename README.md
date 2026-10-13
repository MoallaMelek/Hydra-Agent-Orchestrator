# Hydra v2 (in development)

> **Branch `v2-rebuild`.** Hydra v2 is a new codebase with an original architecture, designed under Melek Moalla's direction and implemented with AI coding assistance. It replaces an earlier version (still on `main`, archived as tag `legacy-v0.2.61`) that was based on the open-source [jpdlr/hydra](https://github.com/jpdlr/hydra) project. The legacy code lives untouched under [`legacy/`](legacy/) with its MIT licence and is not part of v2 builds. See [docs/v2/OWNERSHIP_AND_PROVENANCE.md](docs/v2/OWNERSHIP_AND_PROVENANCE.md).

Hydra orchestrates AI coding agents (Claude Code and Codex CLI) through a supervised lifecycle:

**PLAN → IMPLEMENT → REVIEW → FIX → VERIFY → DEMO → APPROVAL**

- **Isolated by default.** Every task runs in its own git worktree on a `hydra/*` branch. Your working tree changes only when you press Accept, and every apply can be rolled back with a revert commit.
- **Evidence, not claims.** Hydra runs your project's tests and builds itself (Node, Python, Go, Rust, Java, C/C++, or your own `.hydra/checks.json`), records exit codes against the exact commit, and shows before/after results.
- **Independent review.** A second agent (a different provider when available) reviews the diff together with the real test results. Fix rounds are bounded.
- **Budgets.** Per-task limits on cost, tokens, active time and agent runs.
- **Your accounts, your bill.** Hydra uses *your* locally signed-in Claude Code and Codex CLIs. It never stores, proxies or ships credentials.
- **Your data stays local.** Everything is in a local SQLite database. Remote control from a phone is end-to-end encrypted, and no cloud database is involved.

## Status

**Alpha.** Engine, desktop app and encrypted phone control work and are verified with the real Claude Code and Codex CLIs. CI is green on Windows, macOS and Linux. Not yet released: installers are unsigned and an external beta is pending. See [COMMERCIAL_READINESS](docs/v2/COMMERCIAL_READINESS.md), [USER_GUIDE](docs/v2/USER_GUIDE.md) and [TEST_EVIDENCE](docs/v2/TEST_EVIDENCE.md).

## Develop

Requires Node ≥ 22.13 and git.

```bash
npm install
npm run check      # typecheck, lint, tests, provenance
npm run desktop    # build and launch the desktop app
```

## Licence

The v2 licence is **not decided yet** (owner decision pending). Until a licence file is added, no licence is granted for v2 code. The legacy code under `legacy/` remains MIT (see `legacy/LICENSE`).
