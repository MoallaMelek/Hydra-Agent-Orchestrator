# Handoff — Hydra v2 (read this first)

## Current production preparation — alpha.5

Branch `feat/production-preparation-20261018` from alpha.4 `0ed37a1`. Main chat is sole writer/integrator/tester; bounded read-only security/product/distribution consultants. Source and packaged local checks passed (348tests/1skip,13product/7onboarding/4restart assertions). Existing installed alpha.3 and personal projects/data remain untouched; separate fresh preview only. Docker remains stopped. Live provider trial exceeded Codex50k reported-token target by7,097; disclosed, stopped, no further provider calls. Cross-platform existing Actions run authorized, record actual result. Current capability/release gates: PRODUCTION_AUDIT.md, PRODUCTION_PREPARATION.md, COMMERCIAL_PREPARATION.md and TEST_EVIDENCE.md. No main merge, release/publication, license choice, paid signing/account changes or outreach authorized.

## Active safety continuation — 18 October 2026

Branch `feat/engine-enforced-approval-20261018` starts at verified Mission Desk `fc1dccb`; fetched remote main remains `d18a690`. Alpha.4 enforces structured acceptance in the engine across clients. No exception-to-apply workflow exists. See APPROVAL_POLICY.md. Historical notes below describe earlier policy. Existing installed Hydra and personal project data must remain untouched; package/launch a separate preview. No main merge or public release authorized.

## Current milestone — 2026-10-17

See PRODUCT_MILESTONE.md and AGENSI_FULL_PRODUCT.md before the historical notes below. Active branch: feat/hydra-product-milestone-20261017, integrating assessed alpha.3 / 4d2a48b with remote main d18a690. No main merge or public release in this milestone. Final results are recorded in TEST_EVIDENCE.md. The following session-5 table and next-action list are retained historical context and are not current qualification claims. Job objects and desktop signed-manifest update foundations exist; container containment, trusted phone bootstrap, production signing/feed and failure recovery remain open. Current UI uses Workspace, AI accounts and Phone access.

**Branch:** `v2-rebuild` (worktree `C:\Users\moall\hydra-v2`), merged into `main` with the owner's approval on 2026-10-13.

## Where things stand (2026-10-14, pre-beta hardening, session 5)
Latest: commits 1b95e21 → e75be53 on `v2-rebuild` (not merged into `main`). Job objects, explicit phone access, link screening, provider-failure pauses, router evaluation, editable checks, outcome history, update foundation, Grand Prix design, review A5 (9/10 fixed, A5-4 mitigated). See PROGRESS.md and TEST_EVIDENCE.md.

| Area | State | Evidence |
|---|---|---|
| Core engine, isolation, verification | VERIFIED | engine, reliability, delivery and data tests; live Claude/Codex runs |
| Adaptive execution (routing, streaming, pre-started agents) | VERIFIED | `route.test.ts`, `routing.test.ts`, real-Claude benchmark, desktop run |
| History (conversations, follow-ups, search, archive) | VERIFIED | `history.test.ts`, desktop run |
| Remote control | VERIFIED in automated tests; BLOCKED on a physical phone | SECURITY_AUDIT A3; replay (`remote.test.ts`, `sequencer.test.ts`) |
| Independent reviews | A1 engine, A3 remote, A4 adaptive execution: all fixed; A5 pre-beta sprint: 9 of 10 fixed, A5-4 mitigated | SECURITY_AUDIT.md |
| Installers (unsigned) | VERIFIED on fresh CI runners for Windows, macOS arm64, Linux x64 | TEST_EVIDENCE |
| Repository | Only Hydra v2; `main` fast-forwarded to dc6d6e7 with approval; later work is on `v2-rebuild` | D-017 |

Tests: `npm run check` → 243 passed + 1 skipped on Windows, typecheck, lint, originality. Benchmarks: `node tools/bench-latency.mjs` (uses your provider account).

## How to run
- **Develop:** `npm install && npm run check`
- **Desktop app:** `npm run desktop` (builds UI, hydrad and shell, then launches Electron)
- **Engine and UI in a browser:** `npm run build`, then `HYDRA_API_TOKEN=<random> node apps/hydrad/dist/hydrad.mjs --static packages/ui/dist --port 47821`, then open `http://127.0.0.1:47821/#token=<random>`
- **Remote on localhost only:** add `--remote-bind 127.0.0.1 --remote-host 127.0.0.1`
- **Real desktop end to end:** `npm run build && npm run e2e:desktop` (add `--simulate-missing-providers` or `--no-agents`); screenshots in `.hydra-dev/desktop-e2e/`
- **Installer validation:** Actions → v2 CI → Run workflow with `installers: true` (fresh runners; nothing uploaded)
- **Real engineering scenarios:** `node tools/live-scenarios.mjs` (five tasks with Claude Code and Codex; uses your provider accounts)
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
1b. Approve fast-forwarding `main` to the latest `v2-rebuild` (it stopped at dc6d6e7).
2. Repeat `npm run e2e:desktop` on macOS and Linux; extend it to approve the plan and Accept.
3. A single version source (RELEASE_CHECKLIST B6); an update mechanism (C7).
4. Windows Job Objects (T16); a container profile for checks (T5); HTTPS phone UI (T20).
5. Intel macOS build.
