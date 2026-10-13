# Hydra v2 — Handover and readiness report (2026-10-13)

## Verdict
Hydra v2 is a **working, independently written alpha**. The core promise is real and was verified with the real Claude Code and Codex CLIs: agents plan, implement and review in isolation; Hydra runs the tests itself; nothing lands without a human Accept of an exact, verified commit; and every apply can be rolled back. It is **not yet a commercial release**: installers are unsigned, the installer, physical-phone and macOS/Linux packaging runs have not been done, an independent security review of the remote channel is still owed, and there has been no external beta.

## Acceptance criteria from the brief
| Criterion | Status | Evidence / gap |
|---|---|---|
| Independently authored implementation | ✅ | 0% overlap with legacy (6-line shingles) with a positive control; legacy isolated; honest history in OWNERSHIP_AND_PROVENANCE.md |
| Licences and provenance documented | ✅ | THIRD_PARTY.md (10 MIT/ISC packages); provenance doc; v2 licence choice is the **owner's** decision |
| Claude Code and Codex genuinely integrated | ✅ | Live runs in both directions (TEST_EVIDENCE) |
| A real task runs end to end | ✅ | Node and Python fixes, analysis tasks, and the UI flow, all live |
| Changes isolated until final approval | ✅ | Worktrees; Accept bound to the reviewed SHA; integrate and re-verify when the target moved |
| Tests run with verifiable evidence | ✅ | Engine-run checks with exit codes, SHAs, digests and logs; before/after demo |
| Cancellation and recovery | ✅ | Tests: cancel < 3 s, crash recovery, shutdown pause, provider-limit pause |
| Secure and functional remote control | ◐ | E2E encrypted, scoped, revocable; tested on localhost. **Physical phone over Wi-Fi not tested; independent review owed** |
| Usable desktop interface | ✅ | Verified in the browser pane and Electron (development and packaged) |
| Documentation matches reality | ✅ | USER_GUIDE, ARCHITECTURE, REMOTE, THREAT_MODEL, TEST_EVIDENCE |
| CI passes | ✅ | Windows, macOS and Linux green |
| Supported-platform installers tested | ◐ | Windows installer built and packaged app smoke-tested; **installer not run; macOS/Linux not built** |
| No known critical security issue | ✅ (known) | 0 production advisories; two review rounds' findings fixed; residual risks listed below |
| External beta testing completed | ❌ | Owner action |
| Ready for a real user, not just its developer | ◐ | Needs signing, an installer test, and a beta |

## Remaining risks (also in THREAT_MODEL.md)
1. **Unsigned binaries.** SmartScreen and Gatekeeper warnings; no authenticated updates. *Needs code-signing certificates (cost, owner).*
2. **Checks run project code with your user privileges** (T5). Safe mode requires approving the exact check definitions; a container profile is future work.
3. **Phone UI is delivered over LAN HTTP** (T20). Use trusted networks or a VPN until an owner-hosted HTTPS relay exists (D-011).
4. **Windows orphan descendants** of agent processes if their parent exits (T16).
5. **Claude file confinement is enforced by Claude Code**, not by the OS (T1). Codex uses its OS sandbox.
6. **AI-generated code and IP** (OWNERSHIP_AND_PROVENANCE §6): get legal advice before claiming exclusive rights. Check the "Hydra" trademark.

## Commercial packaging
- **Product:** a desktop app with no backend to run, so **$0/month infrastructure**. Customers use their own Claude/Codex accounts (D-012).
- **Agensi:** three original skills are ready in `skills/` (evidence-based verification, independent code review, isolated change workflow). They pass format checks and the artifact scan. **Not submitted**: needs your approval and Agensi account.
- **Do not advertise yet:** macOS/Linux support, signed installers, "works over the internet" remote access, or beta-proven reliability.

## What the owner needs to do next
1. Choose the v2 licence; check the trademark.
2. Approve running the Windows installer (or run it in a VM) and test phone pairing over Wi-Fi.
3. Get code-signing certificates (Windows; Apple Developer ID).
4. Trigger the CI `package` job for macOS and Linux builds.
5. Rerun the independent Codex security review once its quota resets (D-014).
6. Recruit 5–10 beta users; decide on Agensi submission; approve merging `v2-rebuild` into `main` when satisfied.
