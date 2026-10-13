# Roadmap — Hydra v2

Status legend: ☐ not started · ◐ in progress · ☑ done and verified (with evidence in TEST_EVIDENCE.md) · ⛔ blocked (reason given).

## M0 — Originality and architecture
- ☑ Repository preservation (tag `legacy-v0.2.61`, branch `v2-rebuild`, legacy moved to `legacy/`)
- ☑ Provenance assessment (OWNERSHIP_AND_PROVENANCE.md)
- ☑ Architecture, decisions, threat model
- ☑ Independent architecture challenge by Codex (consultant, read-only): D-013
- Acceptance: documents exist; legacy is excluded from the build; provenance check runs in CI.

## M1 — Original core
- protocol package (domain, commands, events, schema versioning)
- store: SQLite, migrations, event journal plus projections
- workflow machine (pure transitions) plus orchestrator with cancellation, timeouts and recovery
- adapters: Claude, Codex (live), scripted (tests only); usage capture
- Acceptance: unit and integration tests; live probe of both CLIs; crash/restart test resumes a task.

## M2 — Safe autonomous development
- worktree isolation, PLAN / IMPLEMENT / REVIEW / FIX / VERIFY / DEMO / APPROVAL, apply, rollback, discard
- verification detectors (node, python, go, rust, java, c/c++, custom) plus runner plus evidence
- budgets and policy modes
- Acceptance: live end-to-end on a real fixture with Claude and Codex; user tree unchanged until Accept; rollback creates a revert commit; Python fixture verified live.

## M3 — Desktop application
- hydrad HTTP/WS API with auth and Host/Origin checks
- design system plus views (projects, tasks, live run, stage rail, diff, evidence, review, approval, providers, devices, settings, audit)
- Electron shell
- Acceptance: UI driven against the real engine in the browser pane and in Electron; screenshots recorded.

## M4 — Remote control
- secure-channel package; pairing; device registry; scopes; revocation; acknowledgements; reconnection
- relay server; phone UI
- Acceptance: automated protocol tests (including tampering, replay, revoked device); live phone-to-relay-to-engine on localhost and LAN; public relay deployment ⛔ until the owner approves infrastructure.

## M5 — Production hardening
- CI (lint, typecheck, test, build, audit, provenance) on Windows, macOS and Linux
- installers (electron-builder): Windows NSIS built and smoke-tested locally; macOS and Linux built in CI and UNVERIFIED locally
- update mechanism design (signed releases required)
- Acceptance: CI green; Windows installer installs and launches; no critical or high advisories in production dependencies.

## M6 — Commercial readiness
- user docs, install guide, demo scenarios, licensing notes, positioning
- Agensi skills (`skills/`), validated against the SKILL.md spec; submission ⛔ until the owner approves
- final handover report

## Out of scope for an AI-only session (needs the owner)
Code-signing certificates · public relay hosting · licence choice · trademark check · external beta testers · release publication · merge to `main`.
