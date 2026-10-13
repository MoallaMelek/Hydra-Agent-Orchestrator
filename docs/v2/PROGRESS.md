# Progress log — Hydra v2

Newest entry first.

## 2026-10-13 · session 3 · final hardening, beta validation, release preparation
- Independent Codex review of remote control: 7 findings (2 High), all fixed; 9 regression tests confirmed failing on the old code (D-015, SECURITY_AUDIT.md). Origin now checked on all local HTTP requests.
- Installers validated on fresh CI runners (Windows NSIS, macOS DMG, Linux deb/AppImage). This found the engine outliving the app (stdin never resumed) and a .deb metadata failure; both are fixed. The first, hung run was cancelled and recorded.
- Real Electron E2E driver (`npm run e2e:desktop`), run with a real agent and with CLIs hidden.
- First-run "Get started" checklist; "no agent ready" warning; Settings backup and JSON export.
- Data ownership: 0700/0600 permissions, keyless export, no-network and credential-isolation tests. Reliability tests: concurrent and conflicting tasks, a burst of 12 tasks, missing check binary.
- Docs: SECURITY_AUDIT, BETA_TEST_PLAN (real phone BLOCKED with a checklist), RELEASE_CHECKLIST, AGENSI_SKILLS, COMMERCIAL_READINESS (~55%).
- Commits d627413 → (this session's last commit); see `git log`.

## 2026-10-13 · session 2 · M3, M4 and most of M5/M6
- UI completed (task view, diff, Hydra-run checks, agents, activity, providers, devices, settings). Verified against the real engine in the browser pane, including a real Codex quota failure, Accept and Rollback.
- Engine: provider usage/rate limits now pause tasks (resumable); engine shutdown pauses running tasks instead of canceling them.
- Electron shell: hydrad runs on Electron's embedded Node 24 (`node:sqlite` verified). Smoke-tested in development and as a packaged app.
- Remote control: `packages/secure-channel` (X25519/HKDF/XChaCha20-Poly1305), hydrad `RemoteHost` (pairing, scopes, revocation, idempotent commands), phone UI. Verified with tests and live (pair → phone-driven task → revoke).
- Hardening: licence report (10 MIT/ISC packages ship), artifact credential scan with a positive control, CI on 3 operating systems (first run found and fixed a macOS/Windows path-canonicalization bug), Windows installer built.
- Docs and skills: USER_GUIDE, REMOTE, COMMERCIAL_READINESS, THIRD_PARTY; three Agensi-format skills.
- Commits: e50dacd, 9ac8729, 31b9ac4, 58a00d6, dbaa66b and later (see `git log`).

## 2026-10-13 · session 1 · M0 + M1/M2 engine
- Architecture and decisions; engine with worktree isolation, engine-run verification, budgets and recovery; hardening after the first Codex review (D-013); live acceptance with real Claude and Codex.
