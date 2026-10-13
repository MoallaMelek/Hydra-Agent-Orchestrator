# Test evidence — Hydra v2

Every entry records what was run, where, and the observed result. `VERIFIED` = observed; `UNVERIFIED` = not exercised; `BLOCKED` = cannot be exercised yet (reason given). Nothing here is inferred from code reading alone.

Environment for all entries unless stated: Windows 11 Pro 10.0.26200 · Node 22.23.2 · npm 10.9.8 · git 2.51.2.windows.1 · Claude Code 2.1.282 · Codex CLI 0.154.0.

## 2026-10-13 — Milestone 1 (engine core)

| # | Check | Command | Result |
|---|---|---|---|
| E1 | Build-config typecheck (protocol, engine) | `npx tsc -b` | VERIFIED pass |
| E2 | Typecheck including tests | `npx tsc -p tsconfig.test.json` | VERIFIED pass |
| E3 | Lint | `npx eslint packages` | VERIFIED pass (0 problems) |
| E4 | Unit + integration tests | `npx vitest run packages/engine` | VERIFIED 42/42 pass (5 files) |
| E5 | Provenance overlap vs `legacy/` | `node tools/provenance-check.mjs` | VERIFIED 0 of 2,387 v2 6-line windows shared with legacy (0.000%) |
| E6 | Provenance detector positive control | copied `legacy/electron/tasks/TaskCoordinator.ts` into v2 temporarily | VERIFIED flagged at 100% and check failed; file removed; check passes again |

### What E4's integration tests prove (scripted agents, real git, real `npm test`)
- Full PLAN→IMPLEMENT→REVIEW→VERIFY→DEMO→APPROVAL with the user's tree unchanged until Accept; Accept fast-forwards; rollback adds a revert commit and history keeps all commits.
- Evidence is collected by Hydra from the real process: the verify phase records exit 0 at the exact head SHA; the demo shows `npm run test` fail→pass between base and final commits.
- Safe mode pauses for plan approval before any write-access agent run; rejection removes the worktree and the `hydra/*` branch.
- Review→fix loop receives the real failing output and stops at the fix budget.
- Human "request changes" text reaches the implementer, and the task returns to approval.
- Cancel stops a running agent in under 3 s and keeps the workspace.
- Cost budget aborts a run using reported usage.
- Crash recovery: a second process opening the database marks the interrupted run, pauses the task, keeps the completed plan, and resume does not repeat planning.
- Remote scopes: view-only devices cannot create tasks; control-scoped devices cannot accept; desktop-only commands are refused remotely.
- The database (full backup copy, sanity-checked to contain task text) contains no API-key, JWT, OAuth-token or email patterns.
- Isolation tests: apply refuses a dirty tree, merges when the user committed meanwhile, aborts cleanly on conflict, and **discarding a worktree never deletes the project's linked `node_modules`**.
- Verification tests: detection for Node (npm/pnpm), Python (pytest/unittest), Go, Rust, Maven, Gradle, CMake, Make and custom checks; the runner distinguishes pass, missing tool and timeout; secrets (`GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`) and `NODE_OPTIONS` are not visible to checks; cwd escape is refused.

### Not yet verified
- Live Claude Code / Codex runs through the engine (next: M1 live acceptance).
- Python fixture executed live (detector unit-tested only so far).
- Go, Rust, Java and C/C++ execution: UNVERIFIED (toolchains not installed on this machine; detectors unit-tested only).
