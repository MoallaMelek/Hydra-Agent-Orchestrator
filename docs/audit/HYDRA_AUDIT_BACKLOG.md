# HYDRA — Audit Backlog (machine-readable)

- **Audited repo:** https://github.com/MoallaMelek/Hydra-Agent-Orchestrator
- **Audited commit:** `38bc58c8991540940af5f32ed7eca5194fcce2f1` (2026-10-10, branch `main`, only branch, clean tree, 8 commits)
- **Upstream origin:** https://github.com/jpdlr/hydra (public, MIT). Fork point = upstream `d8ad561` (2026-05-11)
- **Audit date:** 2026-10-12 · **Auditor:** Claude Opus 5.5 (read-only); independent challenge pass by a fresh, context-less Codex CLI 0.154.0 session (read-only sandbox)
- **Environment:** Windows 11 Pro 10.0.26200 · Node 22.23.2 · npm 10.9.8 · git 2.51.2 · Claude Code 2.1.282 · Codex CLI 0.154.0
- **Evidence tags:** `VERIFIED` = observed by running something or reading the exact code path; `INFERRED` = derived from code but not executed; `BLOCKED` = could not test (missing access/credentials); `UNKNOWN`.
- **Kinds:** `DEFECT` = confirmed bug · `RISK` = suspected/latent risk · `GAP` = missing feature · `ENH` = enhancement
- **Effort:** engineering hours, `optimistic / realistic / pessimistic`. These are estimates, not measurements.

Format: each item is a level-3 heading `### <ID> — <title>` followed by a fixed key list, so it can be parsed line-by-line.

---

## P0 — Blockers (must fix before any external distribution, including Agensi)

### HYD-P0-01 — Provenance and attribution of forked code
- kind: RISK
- subsystem: legal / positioning
- status: VERIFIED
- description: Hydra is a fork of the public MIT project `jpdlr/hydra`. About 32,105 TS/TSX lines come from upstream; the fork added about 3,517 and deleted about 695. The README presents Hydra as the user's product (README.md:1-8, 384) and does not name the upstream project. LICENSE correctly keeps both copyright lines (LICENSE:3-4). The GitHub repo is not marked as a fork (`isFork:false`).
- files: README.md:1-8, README.md:384, LICENSE:1-4, docs/debug/HYDRA-DEEP-AUDIT.md:3
- severity: Critical (credibility and commercial)
- dependencies: none
- solution: Add a clear "Based on jpdlr/hydra (MIT)" credit and NOTICE file. In listings and portfolio, describe only the fork's own contributions: the task coordinator, provider confinement, remote hardening and security tests. Do not sell the inherited desktop app as original work. Optionally contact the upstream author.
- effort_h: 2 / 4 / 8
- acceptance: README names the upstream with a link; NOTICE file exists; no marketing text claims sole authorship of inherited features.
- verify: `grep -i "jpdlr" README.md NOTICE*` returns matches; review the listing copy.

### HYD-P0-02 — Remote Control runs on a third party's Firebase project
- kind: DEFECT
- subsystem: remote / Firebase
- status: VERIFIED
- description: The live PWA at `hydra-remote-moalla-260912.web.app` authenticates against `hydra-za.firebaseapp.com`, the upstream maintainer's project (found in upstream commit `15d6041`). Which rules and functions are deployed there is unknown, and the user cannot control them. The repo's `.firebaserc` has only a placeholder (`your-firebase-project-id`).
- files: firebase-backend/.firebaserc:3, hydra-remote/src/hooks/useRemoteSession.ts:46-58
- severity: Critical
- dependencies: HYD-P0-03
- solution: Create your own Firebase project (Blaze plan, required for Cloud Functions). Deploy the repo's `firestore.rules` and functions, rebuild and redeploy the PWA with your own `VITE_FIREBASE_*`, and turn off the old site or point it elsewhere.
- effort_h: 6 / 12 / 20
- acceptance: The deployed PWA bundle contains only your project ID; rules deployed to your project match `firebase-backend/firestore.rules`.
- verify: download the deployed JS and grep `authDomain`; run `firebase deploy --only firestore:rules --dry-run` against your project.

### HYD-P0-03 — Packaged builds cannot configure Remote Control
- kind: DEFECT
- subsystem: build / remote
- status: VERIFIED (sentinel build)
- description: `firebaseConfig.ts` reads `process.env.MAIN_VITE_HYDRA_FIREBASE_*` at runtime. electron-vite only injects `MAIN_VITE_*` through `import.meta.env`, so the values CI provides are never embedded. A build with sentinel values produced 0 occurrences in `out/`. `.env` is excluded from packages (electron-builder.yml:7-8), and `HYDRA_REMOTE_APP_URL` is never set in release.yml. Remote Control only works if the end user sets 7+ environment variables by hand.
- files: electron/remote/firebaseConfig.ts:11-44, electron/remote/mobileLink.ts:1-7, .github/workflows/release.yml:20-29, electron-builder.yml:7-8
- severity: Critical (advertised feature dead in released builds)
- dependencies: none
- solution: Read `import.meta.env.MAIN_VITE_HYDRA_FIREBASE_*` (statically substituted), or use `define` in electron.vite.config.ts. Add `MAIN_VITE_HYDRA_REMOTE_APP_URL` to the release env. Add a CI step that greps `out/main` for the expected project ID.
- effort_h: 1 / 3 / 5
- acceptance: A release-mode build with real vars embeds them; a packaged app with no env enables Remote Control.
- verify: sentinel test: build with `MAIN_VITE_HYDRA_FIREBASE_PROJECT_ID=SENTINEL`, then `grep -r SENTINEL out/main` finds a match.

### HYD-P0-04 — CI is red on main (lint errors)
- kind: DEFECT
- subsystem: CI
- status: VERIFIED (local and GitHub Actions runs 37461389670, 37837336393, 38086741427)
- description: `npm run lint` fails with 6 errors (no-unsafe-finally ×2, no-useless-escape ×4) in test files. CI stops at Lint, so typecheck and tests have not run in CI since 2026-10-06.
- files: electron/tasks/projectContext.test.ts:27, electron/tasks/providerAdapters.test.ts:31, electron/tasks/verification.test.ts:6
- severity: High
- dependencies: none
- solution: Fix the 6 lint errors and require CI to pass before merging (branch protection).
- effort_h: 0.5 / 1 / 2
- acceptance: GitHub Actions CI is green on ubuntu and windows.
- verify: `npm run lint && npm run typecheck && npm test`; `gh run list --limit 1` shows success.

### HYD-P0-05 — No installable release; README install paths are broken
- kind: DEFECT
- subsystem: distribution
- status: VERIFIED
- description: `gh release list` returns nothing, and `MoallaMelek/homebrew-hydra` returns 404. README sections for Homebrew, DMG, EXE, AppImage and deb (README.md:150-190) cannot be followed. The in-app updater polls a releases endpoint that has no releases (electron/updates/UpdateService.ts:8). macOS signing is disabled (electron-builder.yml:22-24); Windows is unsigned.
- files: README.md:150-190, electron-builder.yml:14-24, electron/updates/UpdateService.ts:8
- severity: High
- dependencies: HYD-P0-04, HYD-P0-06, HYD-P1-12
- solution: Produce a tagged release (start with a dry run), create the tap or remove the Homebrew instructions, and document that builds are unsigned until signing exists.
- effort_h: 4 / 10 / 20
- acceptance: A fresh machine can install from documented instructions only.
- verify: on a clean VM, follow the README and confirm the app launches.

### HYD-P0-06 — Vulnerable and end-of-life dependencies
- kind: RISK
- subsystem: supply chain
- status: VERIFIED (npm audit)
- description: Root production deps have 38 vulnerabilities (3 critical, 16 high), including protobufjs (arbitrary code execution), websocket-driver, proxy-addr, ws and @modelcontextprotocol/sdk 1.26.0. All deps: 74 (6 critical, 41 high). PWA production: 14 (2 critical). Functions production: 23 (3 critical). Electron 33.4.11 is past its support window, and audit flags `electron <=41.10.5`.
- files: package.json:43-61, hydra-remote/package.json, firebase-backend/functions/package.json
- severity: High
- dependencies: none
- solution: Upgrade Electron to a supported major, firebase 10 to current, ws, @modelcontextprotocol/sdk, and firebase-admin/functions. Then rerun the full suite and do a live smoke test. Add Dependabot or Renovate.
- effort_h: 8 / 16 / 32
- acceptance: `npm audit --omit=dev` reports 0 critical and 0 high in all three packages; Electron is within its support window.
- verify: `npm audit --omit=dev` in each package; `npm ls electron`.

### HYD-P0-07 — README materially misdescribes the product
- kind: DEFECT
- subsystem: documentation
- status: VERIFIED
- description: The README advertises YOLO mode (README.md:59-62), but it is hard-disabled (electron/agents/AgentManager.ts:916-921) and the UI still shows a stale `--dangerously-skip-permissions` dialog (src/App.tsx:962). Installs via releases and Homebrew do not exist. The main new feature, the coordinated task workflow (analysis → approval → implementation → review → repair → verification), is not documented anywhere in the README. Mobile capability is overstated.
- files: README.md, src/App.tsx:962, electron/agents/AgentManager.ts:916-921
- severity: High (credibility)
- dependencies: none
- solution: Rewrite the README: accurate feature matrix with status labels, the task workflow, limits (npm-only verification, Windows-only validation), and Remote Control setup on your own Firebase. Remove the YOLO UI remnants.
- effort_h: 3 / 6 / 10
- acceptance: Every README feature claim maps to a passing test or a recorded manual verification.
- verify: review each claim against this audit's feature inventory.

### HYD-P0-08 — Unauthenticated `createSession` Cloud Function
- kind: RISK
- subsystem: Firebase backend
- status: VERIFIED (code) / INFERRED (exploitability)
- description: Anyone holding the public web config can call `createSession` with no caller auth or App Check. Each call creates a Firestore document and mints two custom tokens. This does not grant access to existing sessions, but it allows billing and resource abuse on whoever owns the project.
- files: firebase-backend/functions/src/index.ts:19-70
- severity: High (once you own the backend)
- dependencies: HYD-P0-02
- solution: Enforce App Check, add per-IP and per-installation rate limits plus budget alerts, and optionally require a signed desktop installation identity.
- effort_h: 4 / 8 / 16
- acceptance: Calls without a valid App Check token are rejected; there is a rate-limit test.
- verify: Functions emulator test calling without a token fails with `unauthenticated` or `failed-precondition`.

### HYD-P0-09 — `.env` in the launch directory is injected into every agent's environment
- kind: RISK
- subsystem: process security
- status: VERIFIED (code path) / INFERRED (exploit)
- description: `loadProjectEnvFiles()` loads `.env` from `process.cwd()` and the app path (electron/util/load-env.ts:38-47) into `process.env`. That environment is inherited by PTYs and headless CLIs (AgentManager.ts:478-482, HeadlessOrchestrator.ts:109-112). Launching Hydra from an untrusted directory can set, for example, `NODE_OPTIONS` for child processes.
- files: electron/util/load-env.ts:38-47, electron/main.ts:2-6
- severity: Medium
- dependencies: none
- solution: In packaged builds, load nothing from cwd; allowlist only `HYDRA_*` keys; never propagate loaded keys to child environments.
- effort_h: 1 / 2 / 3
- acceptance: A `.env` with `NODE_OPTIONS` in cwd does not change the child environment (unit test).
- verify: new test spawns a fake CLI and asserts its env.

### HYD-P0-10 — Unpinned remote package executed at runtime (usage dashboard)
- kind: RISK
- subsystem: supply chain
- status: VERIFIED (code)
- description: Codex usage runs `npx -y @ccusage/codex@latest` (with a bunx fallback) on the user's machine (electron/ipc/handlers.ts:665-677). Whatever is published as `latest` executes with the user's privileges.
- files: electron/ipc/handlers.ts:642-700
- severity: Medium
- dependencies: none
- solution: Pin an exact version and verify its integrity, or bundle the dependency, or make the dashboard opt-in with explicit disclosure.
- effort_h: 1 / 2 / 4
- acceptance: No `@latest` or unpinned `npx` in runtime code.
- verify: `grep -rn "@latest\|npx" electron/` returns nothing at runtime.

---

## P1 — Essential (required for a reliable MVP)

### HYD-P1-01 — Shell verification supports npm projects only
- kind: GAP
- subsystem: orchestration / VERIFY
- status: VERIFIED (probe)
- description: `projectVerificationPlan` only recognizes package.json scripts `test|typecheck|lint|build|check` run as `npm run X`. The probe returned an empty plan for Python, Rust and Go fixtures. With Codex selected, those tasks end `blocked`. With Claude only, they can complete only with "limited file verification". Scripts that use `npx` are dropped, and pnpm/yarn evidence is not accepted.
- files: electron/tasks/verification.ts:6-34, electron/tasks/TaskCoordinator.ts:253-262
- severity: High
- dependencies: none
- solution: Add per-ecosystem detectors (pytest, cargo test, go test, pnpm/yarn/bun, make) plus a user-confirmed verification command list stored per project. Allowlist the commands and require exact-match evidence.
- effort_h: 12 / 24 / 40
- acceptance: Live E2E passes on npm, Python and one compiled-language fixture.
- verify: extend `audit-scripts/live-e2e.mjs` with Python and Go fixtures.

### HYD-P1-02 — Claude-only implementation is likely to block in review
- kind: DEFECT
- subsystem: orchestration / REVIEW
- status: VERIFIED (1 of 1 live runs blocked) — Codex review: "not inevitable"
- description: The same-provider reviewer is told "No writes or test execution" and to return `changes_required` if context is insufficient (TaskCoordinator.ts:229). In the live run Claude fixed the bug correctly (an independent `node --test` passed) but flagged "tests not run" twice, and the task ended `blocked` after the single repair round.
- files: electron/tasks/TaskCoordinator.ts:221-252
- severity: High
- dependencies: none
- solution: Let review judge code only and leave test execution to the verification step (state that explicitly in the prompt), or refuse Claude-only implement tasks up front with a clear message. Make MAX_REPAIRS configurable.
- effort_h: 2 / 4 / 8
- acceptance: 5 of 5 live Claude-only fixes on the fixture reach `completed` (limited verification) or are rejected up front.
- verify: `node audit-scripts/live-e2e.mjs <src> out.json implement-claude-only`, repeated.

### HYD-P1-03 — No final human acceptance, no rollback, no isolation from the working tree
- kind: GAP
- subsystem: orchestration / APPROVAL
- status: VERIFIED
- description: The only human gate is the pre-write approval in Safe mode (TaskCoordinator.ts:207-210). Developer and Autonomous modes skip it. Writers edit the user's working tree directly; there is no worktree or branch, no diff review, and no accept/discard. "APPROVAL" as a final stage does not exist.
- files: electron/tasks/TaskCoordinator.ts:141-278, src/components/Tasks/TaskWorkspace.tsx:121
- severity: High
- dependencies: none
- solution: Run each implement task in a git worktree. Present the diff with verification evidence, then Accept (merge/apply) or Discard. Record the decision.
- effort_h: 16 / 28 / 45
- acceptance: The user's main working tree is untouched until Accept; Discard leaves zero changes.
- verify: live E2E asserts `git status` is clean before Accept and shows the diff after.

### HYD-P1-04 — Verification role has write access
- kind: RISK
- subsystem: orchestration / VERIFY
- status: VERIFIED (code) — found by Codex challenge pass
- description: `verification` counts as a writing role (providerAdapters.ts:27), so it runs in workspace-write / project-write mode (Claude gets Write and Edit). "Do not modify" is only a prompt instruction. The post-verification fingerprint check limits the impact, but the fingerprint is incomplete (HYD-P1-05).
- files: electron/tasks/providerAdapters.ts:27-59, electron/headless/HeadlessOrchestrator.ts:96-103
- severity: Medium
- dependencies: HYD-P1-05
- solution: Use a separate sandbox profile for verification (read-only source with a writable temp dir), or verify in a throwaway worktree copy.
- effort_h: 4 / 8 / 14
- acceptance: A verifier attempt to edit sources fails at the sandbox level.
- verify: adversarial test prompt asks the verifier to edit `math.js`; the edit is rejected.

### HYD-P1-05 — Review-to-verification fingerprint does not cover the whole project
- kind: RISK
- subsystem: orchestration integrity
- status: VERIFIED (code)
- description: The fingerprint hashes git status, plus at most 240 files to depth 4, plus content within a 90 KB budget. Files over 1 MB or beyond those limits are not hashed (projectContext.ts:23-61). Changes outside that window between review and verification go undetected.
- files: electron/tasks/projectContext.ts:11-64, electron/tasks/TaskCoordinator.ts:263-264
- severity: Medium
- dependencies: none
- solution: Fingerprint with `git stash create` / `git write-tree` over the full index plus untracked files, or a full-tree hash of all non-ignored files.
- effort_h: 3 / 6 / 10
- acceptance: Changing any non-ignored file after review blocks completion.
- verify: unit test modifies file #500 at depth 6 and expects `blocked`.

### HYD-P1-06 — Remote prompts can be silently lost
- kind: DEFECT
- subsystem: remote
- status: VERIFIED (code) — found by Codex challenge pass and re-checked
- description: `DaemonClient.sendInput` returns void and swallows errors (DaemonClient.ts:244-246). The daemon route always replies `{sent:true}` (DaemonServer.ts:549-553), even when `AgentManager.sendInput` returns false (for example, the project-write guard). RemoteControlService's `delivered === false` check (RemoteControlService.ts:457-458) never fires, so the inbox item is marked processed.
- files: electron/daemon/DaemonClient.ts:244-246, electron/daemon/DaemonServer.ts:549-553, electron/remote/RemoteControlService.ts:454-459
- severity: Medium
- dependencies: none
- solution: Propagate the boolean result end to end; return 409 on rejection; keep inbox items unprocessed and surface the error to the phone.
- effort_h: 2 / 4 / 6
- acceptance: A remote prompt to a guarded project shows an error on the phone and stays unprocessed.
- verify: unit test with a mocked guard asserts no `processed:true` write.

### HYD-P1-07 — Remote input goes straight into interactive PTYs
- kind: RISK
- subsystem: remote / safety
- status: INFERRED (Codex: plausible; depends on the CLI dialog)
- description: A phone prompt is typed into the agent's PTY followed by two Enter keys for Claude (AgentManager.ts:984-998). If the agent is showing a permission dialog, the Enter keys can confirm the highlighted default. A stolen pairing link therefore allows tool approvals during its validity (up to 24 h).
- files: electron/agents/AgentManager.ts:967-1003, electron/remote/RemoteControlService.ts:454-459
- severity: High
- dependencies: none
- solution: Do not deliver remote input while the agent is in a permission prompt state; route remote work through coordinated tasks only; shorten token lifetime and add revoke.
- effort_h: 8 / 16 / 28
- acceptance: An E2E test with Claude at a permission prompt shows remote input is held and not submitted.
- verify: manual test with a fixture that triggers a Bash permission prompt.

### HYD-P1-08 — Firestore write amplification
- kind: DEFECT
- subsystem: remote / cost
- status: VERIFIED (code)
- description: `syncTaskState` rewrites up to 30 task docs every 5 s (RemoteControlService.ts:215) and again on every 15 s heartbeat (:595-605), with no change detection. That is about 28,800 task writes per hour per session at 30 tasks (Codex estimate), against Firestore's free tier of 20,000 writes per day.
- files: electron/remote/RemoteControlService.ts:215, 584-605
- severity: Medium
- dependencies: HYD-P0-02
- solution: Write only on task `changed` events, with a hash per doc and debounce.
- effort_h: 1 / 3 / 5
- acceptance: An idle session with 30 tasks produces 0 task writes per minute.
- verify: unit test counts `setDoc` calls over a simulated 60 s.

### HYD-P1-09 — Firebase security is tested by string matching, not rule evaluation
- kind: GAP
- subsystem: testing / security
- status: VERIFIED
- description: `firebaseSecurity.test.ts` only checks that rule text contains certain substrings. No emulator tests exist; rules were never evaluated in this audit.
- files: electron/remote/firebaseSecurity.test.ts:5-32
- severity: Medium
- dependencies: HYD-P0-02
- solution: Use `@firebase/rules-unit-testing` with the emulator in CI. Cover host vs mobile roles, expiry, closed sessions and inbox schema.
- effort_h: 4 / 8 / 12
- acceptance: The emulator suite passes in CI; mutating a rule fails a test.
- verify: `firebase emulators:exec "npm run test:rules"`.

### HYD-P1-10 — Remote protocol and deployed PWA are out of sync
- kind: DEFECT
- subsystem: remote / PWA
- status: VERIFIED (deployed bundle inspected)
- description: The deployed PWA still sends `get_history`, `stop` and `restart`. The desktop accepts only `handshake|prompt` and marks everything else processed without acting (RemoteControlService.ts:41-57, 416-419). Firestore rules also reject other types (firestore.rules:52). The current source PWA only sends prompts, shows a read-only task list, and still says "Send a prompt or restart" (AgentChat.tsx:1026).
- files: electron/remote/RemoteControlService.ts:41-57, 413-420; hydra-remote/src/components/AgentChat.tsx:1026; firebase-backend/firestore.rules:49-60
- severity: Medium
- dependencies: HYD-P0-02, HYD-P0-03
- solution: Version the protocol (`protocolVersion` in the session doc), redeploy the PWA, and make unknown commands visible errors.
- effort_h: 2 / 4 / 8
- acceptance: The PWA and desktop agree on the protocol version; mismatches show a visible upgrade prompt.
- verify: connect an old PWA build to a new desktop and see the error.

### HYD-P1-11 — No token or cost controls per task
- kind: GAP
- subsystem: orchestration / cost
- status: VERIFIED
- description: Only time budgets (40/60 min total, 10/20 min per run), 12 attempts and 4 concurrent tasks exist. No token or cost accounting per task or attempt.
- files: electron/tasks/TaskCoordinator.ts:17-18, 142-146; electron/tasks/providerAdapters.ts:59
- severity: Medium
- dependencies: none
- solution: Parse usage from Claude `result` events and Codex `turn.completed` usage; enforce a per-task budget; show cost per attempt.
- effort_h: 6 / 12 / 20
- acceptance: A task stops with a clear message when its budget is exceeded.
- verify: unit test with synthetic usage events.

### HYD-P1-12 — Unsigned binaries
- kind: GAP
- subsystem: distribution
- status: VERIFIED
- description: macOS `identity: null`, `hardenedRuntime: false`; no Windows Authenticode. Buyers will see Gatekeeper and SmartScreen warnings.
- files: electron-builder.yml:20-30, .github/workflows/release.yml:21
- severity: Medium
- dependencies: certificate purchase (user decision)
- solution: Get an Apple Developer ID and notarize; get a Windows code-signing certificate (OV/EV or Azure Trusted Signing).
- effort_h: 6 / 12 / 24 (plus certificate cost and lead time)
- acceptance: `spctl -a -vv` accepts the app; Windows signature verifies.
- verify: `signtool verify /pa`, `codesign --verify --deep`.

### HYD-P1-13 — Persistence rewrites the whole task store about once a second
- kind: RISK
- subsystem: reliability / performance
- status: VERIFIED (code)
- description: Every `save()` synchronously serializes and fsyncs all tasks (up to 1000, each with 100 KB summaries and 32 KB logs per attempt) (TaskCoordinator.ts:306, 334-338; atomicStore.ts). The daemon event loop blocks as history grows.
- files: electron/tasks/TaskCoordinator.ts:298-338, electron/tasks/atomicStore.ts
- severity: Medium
- dependencies: none
- solution: One file per task plus an index, or SQLite; debounce writes; move logs to append-only files.
- effort_h: 6 / 10 / 16
- acceptance: Save latency stays under 20 ms with 1000 synthetic tasks.
- verify: benchmark script.

### HYD-P1-14 — Watch-mode test scripts can hang verification
- kind: RISK
- subsystem: orchestration / VERIFY
- status: VERIFIED (probe accepts `vitest` watch script) / INFERRED (hang)
- description: `"test":"vitest"` is accepted into the plan. In watch mode it never exits, so verification would wait for the 10–20 min run timeout.
- files: electron/tasks/verification.ts:6-15
- severity: Low–Medium
- dependencies: HYD-P1-01
- solution: Set `CI=true` for verification commands and give each command its own timeout.
- effort_h: 1 / 2 / 4
- acceptance: The fixture with `"test":"vitest"` finishes in under 2 min.
- verify: live E2E fixture.

### HYD-P1-15 — Project root may be any directory
- kind: RISK
- subsystem: filesystem boundaries
- status: VERIFIED (code)
- description: `canonicalProjectRoot` accepts any existing directory, including the home directory or a drive root (pathPolicy.ts:15-20). The Codex workspace-write sandbox and Claude Write/Edit then cover that entire tree. The Manager MCP can create agents in "any project directory" (McpServer.ts:272-290).
- files: electron/security/pathPolicy.ts:15-20, electron/mcp/McpServer.ts:272-290
- severity: Medium
- dependencies: none
- solution: Refuse home, drive roots and system directories; require a git repo or explicit confirmation for non-repo roots.
- effort_h: 1 / 3 / 5
- acceptance: Creating a task with `C:\` or `~` is rejected.
- verify: unit test.

### HYD-P1-16 — Remote enable timeout does not cancel in-flight setup
- kind: DEFECT
- subsystem: remote
- status: VERIFIED (code) — found by Codex challenge pass
- description: `withTimeout` rejects without cancelling. A late `createSession` can still set state, start timers and attach the inbox listener after the UI reported failure (RemoteControlService.ts:195-233, 313-336, 386-395).
- files: electron/remote/RemoteControlService.ts:184-236, 313-396
- severity: Low–Medium
- dependencies: none
- solution: Use an enable-generation token and check it after each await; tear down on mismatch.
- effort_h: 1 / 2 / 4
- acceptance: A delayed fake `createSession` after the timeout leaves no listeners or timers.
- verify: unit test with fake timers.

### HYD-P1-17 — Cross-platform behaviour not validated
- kind: GAP
- subsystem: reliability
- status: BLOCKED (the repo's own handoff records Windows-only live tests; this audit also ran on Windows only)
- description: There is no live validation on macOS or Linux of coordinated tasks, the Codex sandbox, or PTY behaviour.
- files: .ai/handoffs/final.md
- severity: Medium
- dependencies: none
- solution: Add a CI matrix with a mocked CLI E2E and run manual live smoke tests on macOS and Linux.
- effort_h: 6 / 12 / 20
- acceptance: Live E2E passes on all 3 OSes.
- verify: recorded smoke runs.

---

## P2 — Important (polished commercial product)

### HYD-P2-01 — DEMO stage does not exist
- kind: GAP · status: VERIFIED · severity: Medium · effort_h: 20 / 40 / 70
- description: No code records demos, screenshots or runtime proof after verification. The TaskPhase union has no demo phase (shared/tasks.ts:4).
- solution: Optional demo step: run the app or script in the sandbox and capture output and screenshots as evidence artifacts.
- acceptance: The task result includes demo artifacts when configured. · verify: live E2E on a web fixture.

### HYD-P2-02 — Readability and maintainability of core orchestration code
- kind: ENH · status: VERIFIED · severity: Low · effort_h: 8 / 16 / 24
- description: TaskCoordinator.ts packs complex logic into very long one-line statements (for example lines 173, 229, 256, 274). AgentManager.ts (1134 lines) and ipc/handlers.ts (1133 lines) are monoliths. There are four overlapping orchestration paths: interactive agents, the Manager MCP, headless runs and coordinated tasks.
- solution: Extract a phase state machine, a prompts module and a stage registry; split the handlers.
- acceptance: No function over 80 lines in the tasks module; prompts live in versioned templates. · verify: lint rule `max-lines-per-function`.

### HYD-P2-03 — Intent routing uses regex heuristics
- kind: RISK · status: VERIFIED · severity: Low · effort_h: 2 / 4 / 6
- description: Auto intent combines regexes and model votes; any single "analyze" vote wins (TaskCoordinator.ts:180-188).
- solution: Make explicit intent the UI default and show the routed intent before writing.
- acceptance: The user sees and can override the intent before any write.

### HYD-P2-04 — Misleading cancellation message
- kind: DEFECT · status: VERIFIED (live) · severity: Low · effort_h: 0.5 / 1 / 2
- description: Cancelling during analysis ends with the error "All independent analyses failed; inspect activity for diagnostics", and timeouts show as "Stopped".
- solution: Distinguish user cancel, timeout and failure.

### HYD-P2-05 — Persistent device pairing, push notifications, reconnection UX
- kind: GAP · status: VERIFIED (absent) · severity: Low · effort_h: 24 / 40 / 70
- description: Each desktop launch needs a new QR code; there are no push notifications; the pairing token is kept in localStorage (useRemoteSession.ts:81-113).

### HYD-P2-06 — Renderer bundle size
- kind: ENH · status: VERIFIED (index chunk 10.35 MB) · severity: Low · effort_h: 4 / 8 / 12
- solution: Lazy-load Monaco languages and split chunks.

### HYD-P2-07 — GitHub Actions on deprecated Node 20 runtime; Functions engine node 20
- kind: RISK · status: VERIFIED (CI annotation) · severity: Low · effort_h: 1 / 2 / 3

### HYD-P2-08 — Desktop GUI not verified in this audit
- kind: GAP · status: BLOCKED (not launched) · severity: Medium · effort_h: 8 / 16 / 24
- description: There is no automated UI E2E (Playwright-Electron); UX claims rely on component tests.
- solution: Add Playwright-for-Electron smoke tests: create task, approve, observe completion.

---

## P3 — Optional / future

### HYD-P3-01 — Package reusable workflows as Agensi skills (see report §12)
- kind: ENH · status: GAP (0 SKILL.md files exist) · effort_h: 25 / 45 / 80 for 3 skills
- candidates: `cross-agent-review` (from AI_TEAM.md), `evidence-based-verification` (from verification.ts + semanticResults.ts), `independent-plan-review`.
- acceptance: each passes `skills-ref validate`, is tested on Claude Code and Codex CLI, and passes the Agensi 8-point scan.

### HYD-P3-02 — Manager MCP: semantic completion / wait tool
- kind: ENH · status: VERIFIED (absent) · effort_h: 6 / 12 / 20

### HYD-P3-03 — OpenCode provider completion
- kind: ENH · status: INFERRED (headless provider exists; no task adapter) · effort_h: 6 / 12 / 20

### HYD-P3-04 — Configurable repair rounds and multi-reviewer consensus
- kind: ENH · effort_h: 4 / 8 / 12
