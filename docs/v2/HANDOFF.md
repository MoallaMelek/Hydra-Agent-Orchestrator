# Handoff — Hydra v2 (read this first)

**Branch:** `v2-rebuild` (worktree `C:\Users\moall\hydra-v2`). The owner's main checkout (`OneDrive\Desktop\Projects\hydra`) stays on `main`, untouched. **Legacy:** tag `legacy-v0.2.61`, folder `legacy/`. Never read legacy code when writing v2 (CLAUDE.md). The audit that motivated v2 is in `docs/audit/`.

## Where things stand (end of session 2, 2026-10-13)
| Milestone | State | Evidence |
|---|---|---|
| M0 originality and architecture | ☑ | provenance overlap 0% with a positive control; D-001…D-013 |
| M1 core engine | ☑ | unit and integration tests; live Claude/Codex runs |
| M2 safe autonomous development | ☑ | live Node and Python fixes; accept/rollback; integrate + re-verify; Codex review fixes |
| M3 desktop | ☑ UI and shell | browser-pane E2E; Electron smoke test; packaged app smoke test |
| M4 remote | ☑ LAN/localhost | 8 protocol tests; live pairing, phone-driven task, revocation. ⛔ physical phone over Wi-Fi not tested |
| M5 hardening | ◐ | CI green on Windows/macOS/Linux; 0 production vulnerabilities; artifact scan; Windows installer built. Installer run, signing, mac/linux packages pending |
| M6 commercial | ◐ | user guide; 3 Agensi skills (not submitted); readiness report |

Tests: `npm run check` → 72 tests, typecheck (6 projects), lint, provenance. CI: `.github/workflows/v2-ci.yml`.

## How to run
- **Develop:** `npm install && npm run check`
- **Desktop app:** `npm run desktop` (builds UI, hydrad and shell, then launches Electron)
- **Engine and UI in a browser:** `npm run build`, then `HYDRA_API_TOKEN=<random> node apps/hydrad/dist/hydrad.mjs --static packages/ui/dist --port 47821`, then open `http://127.0.0.1:47821/#token=<random>`
- **Remote on localhost only:** add `--remote-bind 127.0.0.1 --remote-host 127.0.0.1`
- **Live agent acceptance:** `npx tsc -b && node tools/live-e2e.mjs out.json node python analyze` (uses your provider accounts)
- **Windows installer:** `npm run build && cd apps/desktop && npx electron-builder --win nsis --x64 --config electron-builder.yml`

## Pitfalls learned (do not repeat)
- **Never write source code through bash heredocs or `node -e` with backslashes.** It produced NUL bytes, backspace bytes and broken regexes three times. Use the editor tools.
- Git for Windows hides a worktree's `.git` file, so open it with `r+`, not `w`. Test repos need `core.autocrlf=false`.
- `git worktree remove` with a junction inside: always `unlinkDependencies` first (tested).
- Compare **canonical** paths (macOS `/var` → `/private/var`; Windows 8.3 short names on CI).
- Navigating to the same URL with only a new `#fragment` does not reload the page in the browser pane.

## Next actions
1. Act on the second Codex review (`.hydra-dev/codex-consult-remote.md`, local only): fix confirmed findings and record D-014.
2. Owner-approved: run the installer on a test machine or VM; test pairing with a physical phone over Wi-Fi.
3. Run the CI `package` job (workflow_dispatch) for macOS and Linux installers; smoke-test them.
4. Optional container execution profile for checks (THREAT_MODEL T5).
5. External beta (owner).
