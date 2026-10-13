# Progress log — Hydra v2

Newest entry first.

## 2026-10-13 · session 2 · M3, M4 and most of M5/M6
- UI completed (task view, diff, Hydra-run checks, agents, activity, providers, devices, settings). Verified against the real engine in the browser pane, including a real Codex quota failure, Accept and Rollback.
- Engine: provider usage/rate limits now pause tasks (resumable); engine shutdown pauses running tasks instead of canceling them.
- Electron shell: hydrad runs on Electron's embedded Node 24 (`node:sqlite` verified). Smoke-tested in development and as a packaged app.
- Remote control: `packages/secure-channel` (X25519/HKDF/XChaCha20-Poly1305), hydrad `RemoteHost` (pairing, scopes, revocation, idempotent commands), phone UI. Verified with tests and live (pair → phone-driven task → revoke).
- Hardening: licence report (10 MIT/ISC packages ship), artifact credential scan with a positive control, CI on 3 operating systems (first run found and fixed a macOS/Windows path-canonicalization bug), Windows installer built.
- Docs and skills: USER_GUIDE, REMOTE, COMMERCIAL_READINESS, THIRD_PARTY; three Agensi-format skills.
- Commits: e50dacd, 9ac8729, 31b9ac4, 58a00d6, dbaa66b and later (see `git log`).

## 2026-10-13 · session 1 · M0 + M1/M2 engine
- Repository preserved (tag `legacy-v0.2.61`, legacy in `legacy/`); architecture and decisions; engine with worktree isolation, engine-run verification, budgets and recovery; hardening after the first Codex review (D-013); live acceptance with real Claude and Codex.
