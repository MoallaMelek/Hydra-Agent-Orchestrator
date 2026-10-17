# Progress log — Hydra v2

Newest entry first.

## 2026-10-17 · alpha.3 conversation and system surfaces

- Reproduced and removed 1,191px outer-document scrolling in addition to main scrolling. Fixed shell containment; long conversation still scrolls fully inside workspace. New reading/source/execution/composer layout, with matching Settings/Providers/Remote/Project/change-task treatment.
- Confirmed selected project remains old 0.2.61 Desktop checkout; kept it unchanged. Host runtime and selected-root context now distinct in analysis prompts and optional persisted task metadata. Old answers remain historical/unknown; successful answers replace provenance atomically, failed retries preserve old provenance.
- Full check 289 passed/1 skipped, final types/lint/build/package, seven native checks and 84-file scan passed. Real recorded task/replay and three-theme/390px/detail/top/bottom inspections passed. Owner-approved real Claude context test correctly distinguished alpha.3 and 0.2.61 for $0.0390898.
- Installed alpha.3 in place after owner closed app/saved work. One project/five tasks/providers/eight persisted tables retained; exact UI/engine build hashes checked. Broad redesign and production-release gates remain open; see CONVERSATION_POLISH.md.

## 2026-10-17 · visible opening workspace correction, alpha.2

- Owner correctly reported that alpha.1 still resembled the installed design. Replaced the opening composition with selected real work/answer, recorded team operations and adjacent project launch controls; revised the shared frame/navigation while preserving Hydra's mark and three themes.
- Historical work is inspectable while idle. Agent slots only occupy a separate board while real processes run; no demo activity. Inferred operations, disconnected snapshots, missing records and initial/detail loading remain distinct. Added mobile-menu accessible state and remote-empty guidance.
- Check 288 passed/1 skipped, build/package and seven native steps passed. Actual Electron before/after captures, three themes, 390px, keyboard focus, failed-detail recovery and 3s idle DOM=0 validated. No performance equivalence or whole-mandate completion claimed; see OPENING_WORKSPACE.md.

## 2026-10-17 · installed alpha.1 migration

- Following explicit local installation authorization, backed up the closed existing application, engine and desktop profile under restricted user/SYSTEM ACLs. Preserved product identity and install/data paths; no uninstall of the owner's app.
- Created a DPAPI-protected local Ed25519 publisher key; public preview configuration only embedded. No plaintext private key, GitHub secret change, Authenticode certificate or release publication.
- Reproduced PowerShell detached startup exit-without-execution and fixed the handoff using hidden OS Start-Process plus journal readiness acknowledgment and closed launcher pipes. Explicit test data-directory overrides survive restart.
- Separately registered real NSIS alpha.0 → alpha.1 upgrade/restart and corrupt-package rejection/relaunch passed. Disposable history, draft, attachment, theme and provider sign-in survived. These tests do not establish public-release download/click acceptance or partial-installer rollback.
- Final check: 35 files, 288 passed/1 skipped, type/lint/provenance pass (133.22 s); build/package pass; seven packaged native steps and 84-file artifact scan pass.
- Actual installed shell/engine now alpha.1. Database byte-identical immediately after installation; all eight checked persisted tables unchanged after health inspection. One project/four tasks and both authenticated providers preserved. Actual screenshots/receipts retained locally; app reopened normally.
- Read-only follow-up review found no blocker, but startup of the OS launcher lacks its own deadline before the bounded readiness loop. Record this exceptional OS/AV-stall hardening gap before a production release. Other broad mandate gaps remain in WORKBENCH_ACCEPTANCE.md.

## 2026-10-16 · workbench trust and Windows update implementation

- Owner delegated baseline selection: extend installed v2 from cc78c30 on `feat/hydra-workbench-updates`; preserve original old Desktop and newer v2 checkouts.
- Durable independent drafts, bounded text/code attachments, saved-draft recovery, explicit routing/mode, three themes and display-quality preference. Guarded keyboard submission, authoritative final-output precedence and task-keyed replay/freeze.
- Implemented and rendered Workspaces, Timeline and Evidence path over real coordinator records. Two real disposable change tasks reached final approval with 74 s overlap; screenshots use those actual records. No new chain-of-thought display or invented activity.
- Windows update UI/controller, bounded HTTPS, Ed25519/hash verification, opt-in background downloads, unsaved-work refusal, expiring maintenance lease, consistent backup and NSIS handoff. Owner-dispatched protected build/draft-release workflow prepared; no release published or secrets changed.
- Full check/build/native acceptance passed; exact evidence and remaining gaps in WORKBENCH_ACCEPTANCE.md and WINDOWS_UPDATES.md. Full legacy capability parity, participant testing, physical platform matrix, long soak and actual signed installer version-to-version acceptance remain open. Do not claim the entire mandate complete.

## 2026-10-16 · session 6 · Relay interface redesign
- Baseline measured first on the owner's laptop (i7-1355U, Iris Xe, 120 Hz): the old interface spent 26 % of a core in the GPU process and 9 % in the renderer whenever agents ran, from infinite pulse animations; the store re-rendered the app on every event.
- Instrumentation (engine-authoritative, no decision changes): tool activity per run, selection reasons, running runs and slot limit in the snapshot, stage outcome notes, Claude Bash targets.
- Relay trace, command center with agent slots, inspector, freeze, replay, list view; new design system; frame-batched selector store; adaptive quality.
- Measured after: GPU + renderer about 1 % with agents running; flood and stress benchmarks without long tasks; two real concurrent changes watched end to end.
- Independent Codex review R1: 10 findings, all fixed. Branch `redesign/live-operations` (not merged).

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
