# Handoff — Hydra v2 (read this first)

**Branch:** `v2-rebuild` (worktree `C:\Users\moall\hydra-v2`), merged into `main` with the owner's approval on 2026-10-13.

## Where things stand (end of session 3, 2026-10-13: final hardening)
| Milestone | State | Evidence |
|---|---|---|
| M0 originality and architecture | VERIFIED | originality check; D-001…D-015 |
| M1 core engine | VERIFIED | unit, integration and reliability tests; live Claude/Codex runs |
| M2 safe autonomous development | VERIFIED | live fixes; accept/rollback; concurrent and conflicting accepts |
| M3 desktop | VERIFIED | real Electron E2E with a real agent (`npm run e2e:desktop`), onboarding checklist |
| M4 remote | VERIFIED in automated tests; BLOCKED on a physical phone | independent review A3: 7/7 fixed (SECURITY_AUDIT.md) |
| M5 hardening and packaging | VERIFIED (unsigned) | installers install/launch/uninstall/reinstall on fresh Windows, macOS arm64, Linux x64 runners; data ownership tests |
| M6 commercial | Drafted; owner decisions pending | COMMERCIAL_READINESS (~55%), BETA_TEST_PLAN, RELEASE_CHECKLIST, AGENSI_SKILLS |

Tests: `npm run check` → 91 passed + 1 skipped on Windows (POSIX permissions test), typecheck, lint, originality. CI: `.github/workflows/v2-ci.yml`.

## How to run
- **Develop:** `npm install && npm run check`
- **Desktop app:** `npm run desktop` (builds UI, hydrad and shell, then launches Electron)
- **Engine and UI in a browser:** `npm run build`, then `HYDRA_API_TOKEN=<random> node apps/hydrad/dist/hydrad.mjs --static packages/ui/dist --port 47821`, then open `http://127.0.0.1:47821/#token=<random>`
- **Remote on localhost only:** add `--remote-bind 127.0.0.1 --remote-host 127.0.0.1`
- **Real desktop end to end:** `npm run build && npm run e2e:desktop` (add `--simulate-missing-providers` or `--no-agents`); screenshots in `.hydra-dev/desktop-e2e/`
- **Installer validation:** Actions → v2 CI → Run workflow with `installers: true` (fresh runners; nothing uploaded)
- **Live agent acceptance:** `npx tsc -b && node tools/live-e2e.mjs out.json node python analyze` (uses your provider accounts)
- **Windows installer:** `npm run build && cd apps/desktop && npx electron-builder --win nsis --x64 --config electron-builder.yml`

## Pitfalls learned (do not repeat)
- **Never write source code through bash heredocs or `node -e` with backslashes.** It produced NUL bytes, backspace bytes and broken regexes three times. Use the editor tools.
- Git for Windows hides a worktree's `.git` file, so open it with `r+`, not `w`. Test repos need `core.autocrlf=false`.
- `git worktree remove` with a junction inside: always `unlinkDependencies` first (tested).
- Compare **canonical** paths (macOS `/var` → `/private/var`; Windows 8.3 short names on CI).
- `innerText` follows CSS `text-transform`: panel titles read as UPPERCASE, so match text case-insensitively.
- hydrad must `resume()` stdin or its `end` event never fires (the engine outlived the app on macOS).
- `git reset` after `git rm --cached` silently re-tracks files; check `git ls-files` before committing.
- A test driver must never report success with zero steps.
- Navigating to the same URL with only a new `#fragment` does not reload the page in the browser pane.


## Decisions needing approval (owner)
1. Distribute unsigned beta builds to named testers (BETA_TEST_PLAN §10); choose the security contact; approve the privacy statement.
2. Licence for v2 and for the skills (options summarised privately for the owner). Nothing is committed.
3. Product name, after a professional trademark search (§8).
4. Buy code-signing certificates (Windows) and an Apple Developer ID.
5. Submit the Agensi skills at the proposed prices (AGENSI_SKILLS.md).
6. An external penetration test (paid).
7. Merge `v2-rebuild` into `main` (not done; needs approval).
8. Any relay or HTTPS infrastructure for remote access outside the LAN (none deployed).

## Next engineering actions
1. Real-phone session with the owner (BETA_TEST_PLAN §7); record the results.
2. Repeat `npm run e2e:desktop` on macOS and Linux; extend it to approve the plan and Accept.
3. A single version source (RELEASE_CHECKLIST B6); an update mechanism (C7).
4. Windows Job Objects (T16); a container profile for checks (T5); HTTPS phone UI (T20).
5. Intel macOS build.
