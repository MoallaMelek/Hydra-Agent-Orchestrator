# Hydra v2 — Release checklist

Labels: **DONE**, **VERIFIED** (observed evidence in TEST_EVIDENCE.md), **OPEN** (work left), **OWNER** (needs the owner's decision or action), **BLOCKED**.
Nothing here authorises a release. Publishing, tagging a release, uploading installers or submitting listings each needs explicit owner approval.

## A. Every build (automated; must be green)

| # | Gate | How | Status |
|---|---|---|---|
| A1 | Typecheck, lint, tests, provenance | `npm run check` (CI on Windows, macOS, Linux) | VERIFIED: 91 passed + 1 skipped on Windows; green on 3 OS |
| A2 | Build UI, engine host and desktop shell | `npm run build` | VERIFIED |
| A3 | No credentials, credential stores, env files, keys or upstream identifiers in build output and installed files | `tools/scan-artifacts.mjs` (CI, plus installed resources on each OS) | VERIFIED |
| A4 | Shipped licences permissive | `npm run licenses` | VERIFIED: MIT/ISC only |
| A5 | No known vulnerabilities in shipped dependencies | `npm audit --omit=dev --audit-level=high` | VERIFIED: 0 |
| A6 | No v2 import from `legacy/`; similarity report | `npm run provenance` | VERIFIED |

## B. Release candidate (manual dispatch + review)

| # | Gate | How | Status |
|---|---|---|---|
| B1 | Installers build, install, launch, uninstall (data kept), reinstall, leave no engine running | CI workflow_dispatch `installers: true` | VERIFIED: Windows, macOS arm64, Linux x64 (run 38376214916) |
| B2 | Real desktop end-to-end with a real agent | `npm run e2e:desktop` on Windows | VERIFIED (dev build). OPEN: macOS and Linux GUI runs |
| B3 | Live agents end to end (plan → implement → review → verify → accept) | `node tools/live-e2e.mjs` | VERIFIED earlier for Claude and Codex; rerun before each release (uses the owner's quota) |
| B4 | Independent security review of changed security-relevant code | Codex read-only review; findings in SECURITY_AUDIT.md | VERIFIED for engine (A1) and remote (A3) |
| B5 | Real phone pairing | BETA_TEST_PLAN.md §7 | BLOCKED: needs a physical phone and owner presence |
| B6 | Version bump in `apps/hydrad/src/main.ts` (`VERSION`), `apps/desktop/package.json` and the engine default | Manual | OPEN: a single version source would be better |
| B7 | Changelog and known limitations updated | Manual | OPEN |
| B8 | Test plan executed on Intel macOS and a non-Debian Linux | Manual or CI | OPEN |

## C. Before the first paid release (one-time)

| # | Item | Status |
|---|---|---|
| C1 | Windows code-signing certificate (OV or EV) and `signExecutable` re-enabled | OWNER |
| C2 | Apple Developer ID, signing, notarization and stapling (`hardenedRuntime` is already on) | OWNER |
| C3 | Licence and EULA chosen and committed (OWNERSHIP_AND_PROVENANCE §7) | OWNER |
| C4 | Name and trademark clearance (OWNERSHIP_AND_PROVENANCE §8) | OWNER |
| C5 | Privacy statement and security contact published (BETA_TEST_PLAN §6) | OWNER |
| C6 | External penetration test of remote control and installers | OPEN (paid service: owner approval) |
| C7 | Auto-update with signed update metadata, or a documented manual update path | OPEN |
| C8 | Closed beta completed against BETA_TEST_PLAN §8 success criteria | OPEN (no testers invited) |
| C9 | Support channel and refund policy if sold | OWNER |
| C10 | Windows Job Objects for complete process-tree cleanup (T16) | OPEN |
| C11 | HTTPS for the phone UI (owner-hosted relay or local certificate) so LAN tampering is not possible (T20) | OPEN: needs owner approval for any infrastructure |

## D. Release procedure (only after owner approval)

1. Confirm A and B are green on the release commit; record run IDs in TEST_EVIDENCE.md.
2. Get the owner's written approval of: version, the commit SHA, the distribution channel and the release notes.
3. Tag the commit (`v2.x.y`); never move or delete existing tags; never force-push.
4. Build signed installers (after C1/C2) via CI; record sha256 of each file.
5. Run `tools/scan-artifacts.mjs` on each final installer's extracted contents.
6. Publish only to the channel the owner approved.
7. Smoke-test the published download on a clean machine.
8. Keep `main` untouched until the owner approves merging `v2-rebuild`.
