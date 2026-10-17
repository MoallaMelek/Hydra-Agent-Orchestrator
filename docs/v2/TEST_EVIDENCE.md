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
| E5 | Originality check | `node tools/provenance-check.mjs` | VERIFIED: no shared 6-line windows beyond standard boilerplate |
| E6 | Originality detector positive control | a copied file introduced temporarily | VERIFIED flagged at 100% and the check failed; file removed; check passes again |

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
Build sizes: UI 284 KB JS (88 KB gzip), 18.6 KB CSS; hydrad bundle 1.0 MB. `npm run check` passes (typecheck incl. UI, lint, 62 tests, originality).

## 2026-10-13 — Electron desktop shell
| # | Check | Result |
|---|---|---|
| D1 | `node:sqlite` inside Electron 44.7.0's Node (24.21.0) | VERIFIED (SQLite 3.53.4); D-003 resolved, no separate Node runtime needed |
| D2 | Smoke test `HYDRA_DESKTOP_SMOKE=1 electron apps/desktop`: shell starts hydrad, window loads the UI | VERIFIED title "Hydra", stream "Live", home rendered |
| D3 | Renderer isolation: page sees only `hydraHost.{apiUrl, token, pickDirectory, notify}`; `require` and `process` undefined | VERIFIED |
| D4 | Quit stops the engine (no orphan electron.exe processes) | VERIFIED via tasklist |
| D5 | Engine shutdown pauses running tasks (resumable) instead of canceling | VERIFIED (unit test) |
| D6 | Native folder picker, notifications, close-while-running dialog | UNVERIFIED (needs a person at the window) |
`npm run check` → 64/64 tests, typecheck (engine, hydrad, UI, desktop), lint, originality pass.

## 2026-10-13 — Milestone 4: remote control (end-to-end encrypted, no cloud)
Automated (`npx vitest run packages/secure-channel apps/hydrad/src/remote.test.ts`):
- Channel: round-trip both directions; replayed/reordered frames rejected; tampered ciphertext rejected; wrong pairing secret → unusable keys; client pinned to a wrong engine key cannot talk to the real engine; malformed pairing offers rejected. VERIFIED (6 tests)
- Protocol over a real WebSocket: pairing → welcome with scopes; pairing link single use; known device reconnects without secret; desktop-only commands refused remotely; control commands work; command ids idempotent (replay returns stored ack, no duplicate task); approve-level commands refused without `approve`; snapshot hides device list; live task events delivered; revoke closes the live session (4403) and blocks reconnect; wrong secret / unknown device / impostor engine key refused; failed attempts do not consume the pairing. VERIFIED (2 tests)
Live in the desktop browser pane (hydrad with `--remote-bind 127.0.0.1`):
| # | Check | Result |
|---|---|---|
| R1 | Desktop "Pair a phone" shows a QR code, 5-min countdown and engine check code | VERIFIED |
| R2 | Phone page (375×812) shows the same check code (D8CC-C8BA-0EFD), removes the secret from the URL, pairs | VERIFIED |
| R3 | Phone shows the live task list over the encrypted channel; mobile layout renders | VERIFIED (screenshot) |
| R4 | Phone starts a question task; real Claude answers ($0.06); result streams to the phone | VERIFIED |
| R5 | Desktop revokes the phone → phone goes Offline immediately; reload refused with "no longer paired" | VERIFIED |
| R6 | Real LAN access from a physical phone over Wi-Fi (`--remote-bind 0.0.0.0`) | UNVERIFIED (needs a physical device and a firewall prompt approval on this PC) |
`npm run check` → 72/72 tests, typecheck, lint, originality pass.

## 2026-10-13 — Milestone 5: hardening and packaging (Windows, local)
| # | Check | Result |
|---|---|---|
| P1 | `npm audit --omit=dev` (shipped dependencies) | VERIFIED 0 vulnerabilities. Dev tooling: 8 moderate (sprintf-js via packaging tools; not shipped) |
| P2 | `npm run licenses` | VERIFIED 10 shipped third-party packages, all MIT or ISC → docs/v2/THIRD_PARTY.md |
| P3 | `tools/scan-artifacts.mjs` on UI, hydrad and shell bundles and on packaged resources | VERIFIED clean; positive control (planted `.codex/` dir and API-key string) correctly fails |
| P4 | `electron-builder --win dir`: packaged `Hydra.exe` smoke test (engine from bundled resources) | VERIFIED same smoke report as D2 (UI live, 4-key bridge, no Node in renderer) |
| P5 | `electron-builder --win nsis`: installer built, `Hydra-Setup-2.0.0-alpha.0-x64.exe` 111.8 MB, sha256 984f9084c007f901…0491 | VERIFIED built (unsigned) |
| P6 | Running the installer (install, launch, uninstall) | Not run on this PC (owner approval needed). Run on disposable CI runners instead: see "Installer validation" below |
| P7 | macOS dmg and Linux AppImage/deb | VERIFIED on CI runners (see below); not built locally |
| P8 | CI workflow `.github/workflows/v2-ci.yml` (Windows, macOS, Linux) | VERIFIED green on all three (runs 38373152737, 38376204470) |

## 2026-10-13 — Final hardening: independent remote review, installers, data ownership

### Independent security review of remote control (Codex, read-only)
7 findings (2 High, 5 Medium), all fixed; details in SECURITY_AUDIT.md. The 9 new regression tests were run against the previous `remote.ts`/`server.ts`: **9/9 failed on the old code**, 19/19 hydrad tests pass on the new code.

### Installer validation on fresh GitHub-hosted runners (workflow_dispatch run 38376214916, commit e47e388)
Nothing was installed on the owner's PC. Each runner is a disposable VM. Packages are unsigned.

| OS | Package creation | Install | Launch (packaged smoke) | Uninstall | Data kept | Reinstall + relaunch | No engine left running | Artifact scan of installed files |
|---|---|---|---|---|---|---|---|---|
| Windows (x64) | VERIFIED NSIS `Hydra-Setup-2.0.0-alpha.0-x64.exe` 111.8 MB | VERIFIED silent per-user install to `%LOCALAPPDATA%ProgramsHydra` | VERIFIED | VERIFIED program files removed | VERIFIED `hydra.db` kept | VERIFIED | VERIFIED | VERIFIED clean |
| macOS (arm64) | VERIFIED DMG 128.4 MB | VERIFIED app copied from the mounted DMG | VERIFIED | VERIFIED app removed | VERIFIED | VERIFIED | VERIFIED | VERIFIED clean |
| Linux (x64) | VERIFIED .deb 99.4 MB + AppImage 125.4 MB | VERIFIED `apt install` → `/opt/Hydra/hydra` | VERIFIED under Xvfb | VERIFIED `apt remove` | VERIFIED | VERIFIED via AppImage | VERIFIED | VERIFIED clean |

The smoke report checks: the page loads and the stream is live, the renderer has the 4-key bridge and no Node, the app and engine versions match, the data directory and database exist, and providers are reported as not installed on a clean machine (missing-provider detection).

**Not covered:** Gatekeeper/SmartScreen behaviour for downloaded unsigned files (CI bypasses quarantine), double-click GUI install, auto-update (none exists), real provider sign-in on a clean machine.

**Bugs found by this validation and fixed:**
- The engine outlived the app (stdin `end` never fired without `resume()`). The old build was still running 8 s after stdin closed; the new one exits in 55 ms. On macOS the relaunch then blocked on a modal dialog. Two back-to-back local Electron smoke runs now pass.
- The .deb build failed (missing `homepage`).
- The first dispatch (38373164754) was cancelled after macOS hung; this is recorded here, not hidden.

### Data ownership and credential isolation (`packages/engine/src/data.test.ts`)
| Check | Result |
|---|---|
| New database migrates to the current schema | VERIFIED |
| Data dir 0700, database/backups/exports 0600 | VERIFIED by test on macOS and Linux CI (run 38380290732, 5/5); skipped on Windows (per-user profile ACL) |
| JSON export has projects, tasks, runs, devices and contains neither the remote identity key nor device keys | VERIFIED |
| No network client code in engine sources (no telemetry) | VERIFIED by a static scan test; the UI and desktop shell only call the local engine (manual grep) |
| Fake `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` in the environment never appear in the database, WAL, logs, backups or exports after a full task | VERIFIED (scripted agents; real CLIs read their own credential stores) |

`npm run check` → 87 passed, 1 skipped (Windows), typecheck, lint, originality pass.

### Real Electron desktop app (`npm run e2e:desktop`, Windows 11, dev build of commit 37f2534)
Driven over the Chrome DevTools Protocol in the real Electron renderer, not a browser, with a fresh data directory each run. Screenshots are in `.hydra-dev/desktop-e2e*/` (not committed).

| Step | With real CLIs (Claude Code + Codex signed in) | CLIs hidden (`--simulate-missing-providers`) |
|---|---|---|
| First run shows "Get started" with real provider detection | VERIFIED: both Ready | VERIFIED: both "Not installed", with install and sign-in commands; Overview later warns "No agent is ready" |
| Add a project by typing its path | VERIFIED | VERIFIED |
| Safe task with a real agent stops at plan approval; Reject discards it | VERIFIED: Claude planned (2 steps), $0.036 reported, outcome `discarded` | not applicable |
| Stop a running task | VERIFIED: canceled during planning | not applicable |
| Settings → Back up now / Export as JSON | VERIFIED: both files exist | VERIFIED |
| Quit (window close) stops the engine and releases `engine.lock` | VERIFIED | VERIFIED |
| Relaunch keeps the project and task history | VERIFIED (`canceled`, `completed/discarded`) | VERIFIED |

An earlier run failed at "stop a running task" because the driver was still on the task page; that was a driver bug, fixed and rerun. The driver also had a false-pass bug (an empty step list passed); it now requires at least one step and records launch failures.

**Not covered in the desktop run:** full accept and apply through the GUI with real agents (covered by `tools/live-e2e.mjs` and by browser-pane runs earlier), native folder picker (OS dialog), notifications, the packaged build (covered by CI installers), a crash mid-task in the GUI (the engine test covers crash recovery).

## 2026-10-13 — Release hardening: performance, routing, history, remote replay

### Performance (real Claude Code 2.1.282, Windows 11, `tools/bench-latency.mjs`)
Same machine, same fixture, same day. "Provider alone" is the Claude CLI called directly with its default settings. The machine was busy (the Codex desktop app was running dozens of processes), so absolute numbers are pessimistic.

| Scenario | Metric | Before (3 runs) | After (4 runs: 1 cold, 3 warm) |
|---|---|---|---|
| "hi" | Hydra overhead (ack → agent start) | ~10 ms | ~70 ms (git check; made lazy afterwards) |
| "hi" | First visible answer text, median | 4.7 s (nothing streamed; text appeared at the end) | cold 3.3 s; warm 2.5 s median, 1.5 s best |
| "hi" | Total, median | 5.1 s (p95 7.6 s) | 3.4 s |
| "hi" | Provider alone, total median | 7.7 s | 7.2 s |
| Repo question | Total, median | 10.6 s (p95 10.9 s) | 7.8 s |
| Repo question | Provider alone, total median | 14.2 s | 11.8 s |

Option experiment (2 runs each, "hi"): structured JSON output showed nothing until 5.9 s; plain streamed text first appeared at 3.2–3.6 s; disabling tools or low effort gave no gain; a pre-started process gave first text at 1.6–2.4 s. The 2-second first-output target is met only with a pre-started process and depends on provider conditions. Sample sizes are small; treat medians as indicative.

### Routing and safety (automated)
| Check | Result |
|---|---|
| Classifier on a 30-case table (greetings, code questions, changes, bug reports, risky requests) | VERIFIED 30/30, < 0.5 ms per call. The table was written alongside the classifier; this is not an independent accuracy measure |
| Engine: greeting = one streamed read-only run, no worktree, no plan, no review | VERIFIED (`routing.test.ts`) |
| Engine: high-risk change requested in Developer mode is forced to Safe and stops for plan approval | VERIFIED |
| Manual depth overrides the classifier but never removes the risk gate | VERIFIED |
| A secret split across streamed chunks is never published or stored | VERIFIED (12-character chunks of an Anthropic-format key) |
| Follow-up carries the earlier question and answer | VERIFIED |
| Question forced into the pipeline is answered by the planner, workspace removed | VERIFIED (`conversation.test.ts`, and live in the desktop app) |

### Reliability and delivery (automated)
| Check | Result |
|---|---|
| Unavailable provider: refused with `unavailable`, no task stored | VERIFIED (`delivery.test.ts`) |
| Agent cannot start / crashes mid-change: task fails with the reason; workspace kept | VERIFIED |
| Malformed commands: typed `invalid` errors | VERIFIED |
| Phone reconnect: missed `task.log` events replayed after its cursor, other event types excluded | VERIFIED (`remote.test.ts`) |
| Archive/restore a whole conversation; refused while running | VERIFIED (`history.test.ts`) |
| Upgrade: a stored task without the new fields loads with defaults | VERIFIED |
| A process that does not exit 10 s after being stopped is reported, not claimed stopped | Implemented; NOT exercised by a test (could not make a process ignore `taskkill /F` or SIGKILL portably) |

### Real desktop app with a real agent (`npm run e2e:desktop`, Windows 11, dev build)
VERIFIED 10/10 steps: first-run detection; add project; casual question routed to Quick answer (one run) with a natural, rendered reply; follow-up answered with context; question forced into the pipeline answered without a plan; a change routed to Full change, stopped for plan approval and rejected; a running change stopped; backup and export; quit releases the engine lock; relaunch keeps history. The no-agents run also passes.

Driver bugs found and fixed while doing this (not product bugs): the click helper matched the sidebar "+" button's accessible label "Add project"; it now prefers visible text.

`npm run check` → 145 passed, 1 skipped (Windows), typecheck, lint, originality.

### Final numbers after the A4 fixes (`.hydra-dev/bench-final.json`, 4 runs per scenario)
| Scenario | Ack (median) | First words: cold / warm median (best) | Total: warm median (p95) | Provider alone, total median |
|---|---|---|---|---|
| "hi" (routed fast, 1 run each) | 4 ms | 2.7 s / 2.1 s (1.6 s) | 3.0 s (5.1 s) | 6.6 s |
| "What does add() in math.js return?" (routed standard, 1 run each) | 4 ms | 7.7 s / 7.5 s (6.0 s) | 9.0 s (9.7 s) | 11.6 s |

Before the work, "hi" took 5.1 s and showed nothing until done; the repository question took 10.6 s. Repository questions spend most of their time reading files before the first words; the UI now shows what the agent is reading meanwhile. Samples are small and the machine was busy; medians are indicative.

### Final desktop run and packages
- `npm run e2e:desktop` with real Claude on the final code: VERIFIED 10/10.
- Windows installer rebuilt from commit c426346: `Hydra-Setup-2.0.0-alpha.0-x64.exe`, 111.8 MB, sha256 `6df36e06f160c73e546ff59468fbd28e9fc96118f8157d4e4f58f11ffefdd3fb`; artifact scan clean; packaged smoke test passes. Not installed on the owner's PC.
- `npm run check` → 159 passed, 1 skipped (Windows).
- Installer validation on fresh CI runners for commit 332df07 (run 38484276163): Windows, macOS arm64 and Linux x64 all VERIFIED (install, launch with packaged smoke, uninstall keeping data, reinstall, no engine left running, clean artifact scan). The previous dispatch (38483650832) failed in the test stage on macOS and Linux; that found the process-group kill gap fixed in 332df07.

## 2026-10-14 — Pre-beta hardening sprint

### Real engineering tasks with real agents (`tools/live-scenarios.mjs`, Claude Code + Codex, Windows 11)
Disposable repositories, Developer mode, full pipeline, then Accept; the project's tests were then re-run **outside Hydra** on the user's branch.

| Scenario | Agents (plan → implement → review) | Stages | Fix rounds | Hydra's checks | Tests re-run after Accept | Time | Cost |
|---|---|---|---|---|---|---|---|
| Multi-file refactor (extract shared module, 2 callers, new test) | Claude → Codex → Claude | plan, implement, review (approve), verify, demo | 0 | pass | pass; module created; duplicate removed. **Rollback** → module gone, tests pass | 85 s | $0.11 + 29k Codex tokens |
| Feature in Python (method + tests) | Claude ×3 | all | 0 | pass | pass | 48 s | $0.23 |
| Mixed Node + Python (make JS match Python, Python untouched) | Claude → Codex → Claude | all | 0 | JS fail → pass | JS pass, Python pass, Python untouched | 84 s | $0.11 + 28k Codex tokens |
| Missing dependency (`left-pad` not installed) | Claude ×3 | all | 0 | fail → pass (agent replaced it with `padStart`) | pass | 46 s | $0.12 |
| Large project (300 files; bug location not given) | Claude ×3 | all | 0 | fail → pass | pass | 68 s | $0.13 |

Findings from these runs:
- The first run of the refactor stopped for plan approval although nothing risky was planned: the plan-level risk check matched "delete the local formatPrice" with "all tests pass" across the whole plan. Fixed (risk judged per plan step, bounded word distance, bare "all"/"every" no longer count as data). The router's evaluation numbers were unchanged.
- In the mixed-language run the agent also edited the test file (Hydra flags modified tests at approval).
- No scenario needed a repair round, so bounded repair was not exercised live (covered by automated tests). Merge conflicts were not exercised live (covered by automated tests with real git).

### P0 security fixes (automated, real processes and real git)
| Check | Result |
|---|---|
| Windows: cancelling ends a tree including a grandchild that ignores SIGTERM/SIGINT | VERIFIED (`containment.test.ts`) |
| Windows: a descendant left behind after its parent finished is terminated | VERIFIED; **fails with job objects disabled** (and left two real stray processes, removed afterwards) |
| Windows: force-killing the engine ends every process it started | VERIFIED |
| Unrelated processes are never terminated | VERIFIED |
| macOS/Linux: same tests with process groups | VERIFIED in CI (run 38488683514, all 3 OS green, including installers with koffi packaged) |
| Phone access: off until enabled, bound to one address, expires, foreign address refused, a phone cannot toggle it, audited | VERIFIED (`remote.test.ts`) |
| Links outside the project: absolute, Windows-drive and escaping links flagged, inside links not; checks refused; Accept refused and branch unmoved | VERIFIED (`links.test.ts`, real git) |
| Crash leftovers swept without following links into the project | VERIFIED |

### P1/P2 (automated)
| Check | Result |
|---|---|
| Provider failures: 9 CLI-style messages classified; expired sign-in pauses and Resume completes; one network blip retried; lasting network failure pauses after exactly 2 runs; missing CLI pauses; crash fails with reason | VERIFIED (`provider-failures.test.ts`). Real sign-in expiry and real network loss were not provoked |
| Router, 76 dev + 38 held-out cases | dev 71.1% → 98.7%, held-out 71.1% → 94.7%; risky requests missed 6 → 0 and 3 → 0 |
| Verification editor: validation, save/restore, real test runs, used by new changes, phone refused; desktop e2e shows a real failing run | VERIFIED |
| Outcome records contain no prompt or answer text; recommendation rule vs history (≥ 5) with counts | VERIFIED |
| Updater: valid/tampered/foreign-key manifests, HTTP refused, older versions ignored, checksum/size mismatch deleted | VERIFIED (`updater.test.ts`); no real release exists |

### Independent review A5 (Codex, read-only) and fixes
10 findings (3 High, 6 Medium, 1 Low); SECURITY_AUDIT.md has the table. Regression tests confirmed failing on the old code: A5-2 (phone socket survived disable until the 4408 handshake timeout), A5-6 (sweep went through a link and emptied the temporary project), A5-9 (a link at the download name was overwritten). Router after the A5 patterns: dev 98.7%, held-out 94.7% (unchanged), risky missed 0; review probes 23/23 (tuned on them, so not an accuracy figure). Full gate: 243 passed, 1 skipped (Windows). CI on macOS/Linux had been red since 2cb317a (validator did not recognise `C:\...\curl.exe` there); fixed in e75be53. A5-4 (job assignment race) is mitigated, not eliminated, and was not reproduced.

### Latency after the sprint (real Claude, 3 runs; `.hydra-dev/bench-sprint.json`)
| | Ack | First words warm | Total warm | Total cold |
|---|---|---|---|---|
| "hi" | 9 ms | 1.7 s | 2.7 s | 4.6 s |
| Repo question | 5 ms | 5.9 s | 7.8 s | 8.5 s |

No regression from job objects (previous: "hi" 2.1 s / 3.0 s warm).


## 2026-10-17 — greeting-prefixed bug reports
Short greetings no longer hide crash/broken symptoms. Added three routing regressions; npm run check passed (245 passed, 2 skipped), typecheck, lint and provenance passed. Codex implemented and verified.


## 2026-10-17 — outcome medians
Even observation counts now average the central pair rather than underreporting duration and cost. Regression test covers both fields. npm run check passed: 246 passed, 2 skipped; typecheck, lint and provenance passed.


## 2026-10-17 — budget failure guidance
Paused budget failures now show budget recovery instructions instead of generic Resume guidance. Regression test plus npm run check passed: 247 passed, 2 skipped; typecheck, lint and provenance passed.
