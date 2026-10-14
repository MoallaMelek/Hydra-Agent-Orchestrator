# Hydra — Commercial readiness (updated 2026-10-14, pre-beta hardening session)

## Verdict
Pre-beta hardening (session 5): Windows process trees are now held in OS job objects (verified with real processes); phone access is off unless turned on, for a limited time, on one address; links leaving the project block checks and Accept; provider sign-in, limit and network failures pause with guidance; the router was measured on 114 labelled requests; verification commands are editable; a local outcome history drives transparent recommendations; a signed-update foundation exists but no release is published. A fifth independent review (A5) found 10 issues: 9 fixed with regression tests, 1 mitigated. Five real engineering tasks with Claude Code and Codex all succeeded. Still no real users, no physical phone, no signing, no pentest.

Since the previous assessment: simple questions are answered by one streamed agent call (median 3.0 s total, first words after about 2 s when warm, against 5.1 s with nothing shown before). Hydra routes each message automatically (quick answer, code question or full change) and forces plan approval for risky changes. History has conversations, follow-ups, search and archive. A phone that reconnects replays what it missed. A second independent review (A4) found 6 issues, all fixed with regression tests.

Hydra v2 is a **working, independently written alpha that is ready for a closed beta once the owner approves distribution**. It is **not ready for a paid public release.** What changed in this session:
- An independent security review of remote control found 7 issues. All are fixed with regression tests that fail on the old code.
- Real installers were installed, launched, uninstalled and reinstalled on fresh Windows, macOS and Linux machines (CI runners). That run found and fixed a bug where the engine outlived the app.
- The real Electron app was driven end to end with a real agent.
- The work proves data ownership and credential isolation, adds reliability stress tests and first-run onboarding, and drafts beta, release, licensing and trademark documents.

The blockers for selling are mostly owner actions: signing certificates, licence, name, beta and an external pentest.

Labels: VERIFIED (observed evidence in TEST_EVIDENCE.md) · DONE (implemented, tested indirectly) · UNVERIFIED · BLOCKED · FAILED · OWNER (needs the owner).

## Acceptance criteria
| Criterion | Status | Evidence / gap |
|---|---|---|
| Independently authored implementation | VERIFIED | `npm run provenance` originality check; written for this product |
| Claude Code and Codex genuinely integrated | VERIFIED | Live end-to-end runs (both providers); desktop run with real Claude planning |
| Changes isolated until final approval; rollback | VERIFIED | Engine tests and live runs; concurrent and conflicting accepts (reliability tests) |
| Tests run by Hydra with verifiable evidence | VERIFIED | Engine-run checks with exit codes, SHAs, digests and logs |
| Cancellation, crash recovery, restart | VERIFIED | Engine tests; Stop in the real desktop app; history kept across relaunch |
| Concurrency and failure handling | VERIFIED | `reliability.test.ts`: 2 concurrent tasks (disjoint and conflicting), a burst of 12 tasks, a check that cannot start |
| Remote control secure | VERIFIED in automated tests; **real phone BLOCKED** | SECURITY_AUDIT A3 (7/7 fixed); manual checklist in BETA_TEST_PLAN §7 |
| Desktop app usable | VERIFIED | `npm run e2e:desktop` (with real CLIs, and with CLIs hidden) on Windows; onboarding checklist |
| Fast simple questions; adaptive execution | VERIFIED | Routing table 37/37; engine routing tests; real-Claude benchmark (TEST_EVIDENCE); desktop run picks Quick answer with one agent run |
| Conversation history | VERIFIED | Follow-ups with context, search, archive/restore, delete confirmation, upgrade from older databases |
| Installers per OS | VERIFIED on fresh CI runners (unsigned) | Windows NSIS x64, macOS DMG arm64, Linux deb/AppImage x64: install → launch → uninstall (data kept) → reinstall → no leftover engine |
| Customer account isolation | VERIFIED | Provider-specific env allowlists; fake keys never reach the DB, logs, backups or exports; artifact scans of installed files; providers show "not installed" on clean machines |
| Database ownership | VERIFIED | Local SQLite; migrations; 0700/0600 on macOS/Linux; backup and keyless JSON export from the UI; no network client code in the engine |
| No known unfixed High/Critical issue | VERIFIED (as far as reviewed) | 0 production advisories; two independent review rounds fixed |
| External beta | OWNER | Plan ready, nobody invited |
| Licence, name, signing | OWNER | RELEASE_CHECKLIST C1–C5 |

## Readiness estimate (judgement, not a measurement)
| Area | Weight | Estimate | Main gap |
|---|---|---|---|
| Core function and safety model | 25% | 92% | Repair rounds and merge conflicts not exercised live; pattern-based risk gate |
| Security | 20% | 76% | No external pentest; HTTP phone page while access is on; pattern-based risk gate and redaction; checks run with user permissions; A5-4 race mitigated only |
| Packaging and distribution | 15% | 57% | Unsigned; no notarization; update foundation only (no key, hosting or release); no Intel macOS build |
| UX and onboarding | 10% | 82% | No real-user testing; phone UX not tried on a device |
| Validation with real users | 15% | 5% | No beta; no physical phone |
| Legal and business (licence, trademark, privacy, support) | 15% | 20% | All drafted, none decided |

**Weighted commercial readiness: about 59%** (was 57%). The engineering gaps that remain are small; what blocks selling is owner decisions and real-user validation (beta, phone, signing, licence, name, pentest).

## Blockers to a paid release
1. Code signing (Windows) and Developer ID with notarization (macOS): OWNER, costs money.
2. Licence/EULA, privacy statement, security contact: OWNER.
3. Name and trademark clearance: OWNER (a professional search is recommended).
4. Closed beta meeting the success criteria: OWNER to approve testers.
5. External penetration test: OPEN, a paid service needing owner approval.
6. Real-phone validation: BLOCKED until a device session.
7. Update mechanism: OPEN.

## Residual risks (also in SECURITY_AUDIT.md and THREAT_MODEL.md)
- Verification runs project code with the user's privileges (T5).
- Phone UI over plain HTTP on the LAN (T20).
- Windows grandchild processes may outlive a canceled run (T16).
- Claude's file confinement is enforced by Claude Code, not the OS (T1); Codex uses its OS sandbox.
- AI-assisted authorship may limit exclusive IP claims in some jurisdictions; get legal advice before relying on them.
- "Hydra" is a common name in developer tools; a professional trademark search is advised before launch.

## Commercial packaging
- Product: a desktop app with no backend, so **$0/month infrastructure**. Customers use their own Claude/Codex accounts (D-012). No telemetry.
- Agensi: three skills audited, with listing copy and prices drafted (AGENSI_SKILLS.md). **Not submitted.**
- Do not advertise yet: signed installers, internet remote access, Intel macOS, beta-proven reliability.

## Owner decisions needed
See HANDOFF.md "Decisions needing approval".
