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

## 2026-10-13 — Live acceptance with real CLIs (`node tools/live-e2e.mjs`)
Run 1 (before hardening) and run 2 (after commit d5b515a), temp git fixtures, operator's own accounts:
| Scenario | Roles | Result | Evidence (Hydra-run) | Accept → test | Rollback → test | Time / cost |
|---|---|---|---|---|---|---|
| Node cart bug | plan Claude, impl Codex, review Claude | VERIFIED all 5 stages, final approval | `npm run test` base exit 1 → final exit 0 | fast-forward, pass | revert commit, fails again | 51 s · $0.075 + 27k unpriced Codex tokens |
| Python slugify | plan Codex, impl Claude, review Codex | VERIFIED | `unittest` exit 1 → exit 0 | fast-forward, pass | fails again | 64 s · $0.053 + 54k unpriced |
| Analyze (run 1) | Codex | VERIFIED correct answer, tree clean | — | — | — | 25 s |
Auth detection live: Claude `authenticated: true, method claude.ai`; Codex `authenticated: true, method ChatGPT`; no identity fields kept.
Totals after hardening: `npx vitest run packages apps` → 62/62 pass; `tsc -b`, `tsc -p tsconfig.test.json`, `eslint packages apps` clean.
Observation: in the Python run the implementer also modified the test file and the reviewer approved it. The UI now warns about modified test files (packages/ui/src/views/task/warnings.ts — not yet compiled).

## 2026-10-13 — Milestone 3: desktop UI against the real engine (browser pane)
Setup: `npm run build -w @hydra/ui`, `npm run build -w @hydra/hydrad`, `node apps/hydrad/dist/hydrad.mjs --static packages/ui/dist --port 47821` with a fresh data dir and a throwaway `cart-service` repo; UI opened at `http://127.0.0.1:47821/#token=…` in the Claude desktop browser pane (1440×900).
| # | Check | Result |
|---|---|---|
| U1 | UI loads, authenticates over HTTP + WebSocket, token scrubbed from URL | VERIFIED (sidebar "Live") |
| U2 | Add project via dialog | VERIFIED |
| U3 | Composer defaults to ready providers; mode text; same-provider reviewer hint | VERIFIED |
| U4 | Safe-mode task: live pipeline, real Claude plan shown, Approve/Reject gate, sidebar "needs you" dot, cost meter ($0.07) | VERIFIED |
| U5 | Approve → Codex implement **failed: the Codex account's usage limit was reached** ("try again at 6:46 AM"). Task shows Failed with the provider's message and a Resume button; nothing written | VERIFIED (real provider failure handled; improvement: pause instead of fail, see PROGRESS) |
| U6 | Developer-mode task, Claude in all roles: Plan→Implement→Review→(Fix skipped)→Verify→Demo→Approval in < 60 s, $0.18; same-provider warning; Before→After `npm run test` fail→pass | VERIFIED |
| U7 | Changes tab shows the exact one-line diff | VERIFIED (page text) |
| U8 | Accept from UI → status Applied, workspace removed; on disk `main` fast-forwarded to the reviewed SHA, test passes | VERIFIED |
| U9 | Roll back from UI → revert commit, history kept, test fails again | VERIFIED |
| U10 | Providers page shows live version, signed-in method, capabilities | VERIFIED |
| U11 | Phone-width layout | UNVERIFIED (screenshots timed out in the pane; layout CSS has a ≤900 px breakpoint) |
Build sizes: UI 284 KB JS (88 KB gzip), 18.6 KB CSS; hydrad bundle 1.0 MB. `npm run check` passes (typecheck incl. UI, lint, 62 tests, provenance).
