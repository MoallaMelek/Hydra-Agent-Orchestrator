# Progress log — Hydra v2

Newest entry first.

## 2026-10-14 · session 5 · pre-beta hardening and intelligence
- P0: Windows job objects (koffi) with real-process tests; phone access off by default, explicit, time-limited and bound to one address; links leaving the project refused for checks and Accept; crash leftovers swept safely; EXECUTION_BOUNDARIES.md.
- P1/P2: provider failures classified (sign-in, limit, network with one retry, missing CLI) and paused with guidance; router evaluated on 114 labelled requests (dev 98.7%, held-out 94.7%, 0 risky missed); editable verification commands; local outcome history with transparent recommendations; plain-language failure explanations.
- P3: signed-update foundation (verification and download only; release key, hosting and signing BLOCKED on the owner); Grand Prix design (GRAND_PRIX.md, design only).
- Five real engineering scenarios with Claude Code and Codex, all succeeded.
- Independent Codex review A5: 10 findings, 9 fixed with regression tests, 1 mitigated (A5-4). CI found a macOS/Linux validator defect (red since 2cb317a), fixed in e75be53.
- Commits 1b95e21 → e75be53.

## 2026-10-14 · session 4 · release hardening, performance, ownership
- Ownership: the repository now contains only Hydra v2 (legacy code, its audit and provenance write-up removed from the tree; private copy kept by the owner); `main` fast-forwarded with approval (D-017).
- Performance: measured first (Hydra overhead ~10 ms; time was in provider start-up and non-streamed JSON answers). Added a deterministic router (Auto / Quick answer / Code question / Full change), streamed plain-text answers, pre-started Claude processes, a risk gate on requests and on plans. "hi": 5.1 s → 3.0 s total, first words ~2 s warm.
- UX: one composer with a live route preview; conversation view with streaming, follow-ups and "Make this change"; live "Reading …" activity; history with search, archive and paging; delete confirmation.
- Reliability: phone replay after reconnect; honest reporting of processes that will not stop; delivery/failure tests; keep-alive ECONNRESET fix.
- Independent Codex review A4: 6 findings, all fixed with regression tests.
- Commits a1a0a8c → c426346 (see `git log`).

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
# 2026-10-17

- Corrected updater SemVer precedence; regression tests and required checks passed.
- Bounded update manifest network waits and corrected equal numeric prerelease comparison after independent review.
- Approval digests now include package-manager lockfiles and development requirements, preserving binary bytes.



## 2026-10-17 — greeting-prefixed bug reports
Short greetings no longer hide crash/broken symptoms. Added three routing regressions; npm run check passed (245 passed, 2 skipped), typecheck, lint and provenance passed. Codex implemented and verified.


## 2026-10-17 — outcome medians
Even observation counts now average the central pair rather than underreporting duration and cost. Regression test covers both fields. npm run check passed: 246 passed, 2 skipped; typecheck, lint and provenance passed.


## 2026-10-17 — budget failure guidance
Paused budget failures now show budget recovery instructions instead of generic Resume guidance. Regression test plus npm run check passed: 247 passed, 2 skipped; typecheck, lint and provenance passed.


## 2026-10-17 — provider HTTP timeout recovery
Undici connect/header/body timeout codes now classify as transient network failures for the existing retry/pause flow. Three regression cases; npm run check passed: 250 passed, 2 skipped; typecheck, lint and provenance passed.


## 2026-10-17 — event cursor acknowledgment
Durable events advance the replay cursor only after the view callback succeeds, so an isolated failed update can replay. Reentrant newer updates cannot move the cursor backwards. Two regressions; npm run check passed: 252 passed, 2 skipped; typecheck, lint and provenance passed. Independent read-only Codex review found no blocking regression in this five-fix batch. Residual: a subsequent durable event can still advance beyond a failed callback before reconnect.
