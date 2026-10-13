# Handoff — Hydra v2 (read this first)

**Branch:** `v2-rebuild` (worktree `C:\Users\moall\hydra-v2`; the owner's main checkout `OneDrive\Desktop\Projects\hydra` stays on `main`, untouched). **Legacy archive:** tag `legacy-v0.2.61`, folder `legacy/`. Never read legacy code when writing v2 (see CLAUDE.md).

## State at end of session 1 (2026-10-13)
- **M0 done:** provenance, architecture, decisions D-001…D-013, threat model T1–T19, roadmap.
- **M1/M2 engine done and verified:** `packages/protocol`, `packages/engine`. 62 automated tests pass. Live acceptance with real Claude Code 2.1.282 and Codex CLI 0.162 passed twice (before and after hardening): Node and Python bug fixes went PLAN→…→APPROVAL, tree untouched until Accept, Accept fast-forwards, independent test passes, Rollback restores. Details in TEST_EVIDENCE.md.
- **Independent Codex review** (25 findings) addressed in commit `d5b515a`; residual risks listed in D-013.
- **M3 UI done and verified in the browser pane** (see TEST_EVIDENCE M3 table). Electron shell not started.
  - `apps/hydrad` (API server) done and tested (6 security tests).
  - `packages/ui` is **incomplete WIP**: design system, store, transport, Shell, Home, Project, NewTaskForm, DecisionBar, OverviewTab and ChangesTab are written.
  - **Missing:** `views/TaskView.tsx`, `task/ChecksTab.tsx`, `task/AgentsTab.tsx`, `task/ActivityTab.tsx`, `ProvidersView.tsx`, `DevicesView.tsx`, `SettingsView.tsx`, `src/main.tsx`, `index.html`, `vite.config.ts`, the UI tsconfig, and `npm install` of the UI deps (react 19.3, vite 8.3.4, lucide-react 1.55, @vitejs/plugin-react 6.1.2).
  - The UI has **never been compiled**; expect type errors.
- **Not started:** `apps/desktop` (Electron shell), M4 remote (`packages/secure-channel`, `apps/relay`), M5 CI/installers, M6 docs/skills.

## Next actions, in order
1. Finish the missing UI files listed above. Add the UI to `tsconfig.json` references (with jsx and the DOM lib), build with Vite, and have hydrad serve `packages/ui/dist` (`--static`). Verify in the browser pane against a real engine (`hydrad --print-token`, open `http://127.0.0.1:<port>/#token=…`); the UI should read the token from the fragment.
2. Electron shell: spawn the hydrad bundle (`npm run build -w @hydra/hydrad`). Verify `node:sqlite` inside Electron's Node; if absent, ship a Node runtime.
3. M4 per ARCHITECTURE §11 and D-011: LAN-first E2E channel, then the relay. Do not deploy any cloud resource without the owner's approval.
4. CI workflow (lint, typecheck, test, provenance, audit) on Windows, macOS and Linux.

## Owner decisions pending
v2 licence · trademark check · code-signing certificates · relay hosting · Agensi submission · merge to `main`.
