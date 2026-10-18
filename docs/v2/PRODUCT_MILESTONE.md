# Hydra Mission Desk — product milestone, 2026-10-17

Historical alpha.3 milestone record. Alpha.4 supersedes its UI-only override policy: acceptance is now enforced by the engine, unresolved checks/review refuse application in all modes, and no exception-to-apply workflow is supported. See APPROVAL_POLICY.md and TEST_EVIDENCE.md for current evidence.

## Source and scope

Assessment baseline: alpha.3, `4d2a48b`. The Desktop checkout was `3699b25` / 0.2.61 and was deliberately left in place. Work continues in the existing v2 worktree. This milestone integrates remote main `d18a690` into a dedicated feature branch, preserving alpha.3 features and the newer hardening fixes. It does not merge into main or qualify a public release.

The product is the full Electron application, its local engine and its daily workflows. A skill package is not a substitute for Hydra. The coherent milestone is a simpler product surface with a truthful decision loop and bounded history/replay. Further security infrastructure and platform qualification are release gates, not visual tasks.

Regression verification reproduced the existing Git worktree bookkeeping race. The repository's already reviewed fix from `6e8c4a2` was ported from `fix/git-worktree-admin-lock`: per-common-Git-directory add/remove/prune serialization, disabled automatic maintenance, and the original real-Git invariant tests. Check execution remains parallel; this coordinates this engine's bookkeeping, not unrelated external Git processes.

## Concepts compared

Scores are design judgments (1–5), not user-study results.

| Concept | Comprehension | Originality | Feasibility | Accessibility | Usability |
|---|---:|---:|---:|---:|---:|
| Conversation + mission receipt | 5 | 4 | 5 | 5 | 5 |
| Project notebook | 4 | 4 | 3 | 5 | 4 |
| Spatial agent board | 2 | 5 | 3 | 2 | 3 |

Selected: conversation + mission receipt. The distinctive artifact is a readable, durable record of the proposed revision, review and observed checks. It makes the human decision the center of the product. A notebook would require a new knowledge model; the spatial board makes orchestration concepts a prerequisite to getting work done. Existing operations diagrams remain available under Work details.

## Direction contract

Operate mode. A developer at a normal desktop display should understand the current request, what Hydra recorded, and what their next decision will do. A compact side navigation holds projects and three plain destinations: AI accounts, Phone access, Settings. Workspace begins with the selected project and one request surface. A change opens with the request, response, mission receipt and decision; diagrams are opt-in. A sage signal on slate and a corresponding light palette give the request and receipt their own identity; Terracotta remains available. System typography preserves cross-platform legibility without new font dependencies. No fake thinking, invented progress percentages, simulated agents in production, decorative idle loops or new network services.

## Acceptance contract and verification ledger

| Criterion | Required evidence |
|---|---|
| Same hierarchy across onboarding, workspace, project/history, accounts, tasks, settings and remote | Packaged screenshots in dark/light/terracotta and narrow/medium/wide windows |
| No missing or failed checks called verified | Tests for exact revision, absent records, stale records, timeout, mutation and failure; packaged override check |
| Applying unresolved evidence is explicit | UI acknowledgement bound to revision; engine audit records its own evidence state; existing exact-SHA enforcement retained |
| History does not load all task bodies | 25 summary records/page, stable date+ID cursor, server-side search; boot task count capped at 100; 1,000-task regression |
| Live cache stays bounded | 500 task records, 40 loaded details; history remains authoritative in SQLite |
| Local replay yields and has backpressure | 64-event batches; 2 MiB outbound and live-backlog caps; reconnect from applied cursor; negative tests |
| Known credential formats do not leak across check-log chunks | Every split position, UTF-8, PEM, EOF, long-line and independent-stream regressions |
| Recovery has actionable limits | Helper-launch deadline test; interrupted work remains paused; retained rollback/backup tests |
| No silent release side effects | No publish, deployment, purchase, tester invitation, main merge, license change or new provider spend |

Executed results and limitations belong in TEST_EVIDENCE.md and the milestone report. This contract is not a claim that every criterion has passed.

## Product coverage

| Surface | Milestone behavior |
|---|---|
| First run | Explain idea → isolated change → evidence → decision; existing BYOA checklist |
| Workspace | Project-aware composer, decisions and recent work; operations disclosed |
| Project | Request sheet; check configuration disclosed; paginated searchable task/message history |
| Question | Existing conversation, follow-up and source/runtime distinction; older parent fetched on demand |
| Change | Request/response and mission receipt; changes, checks, review, activity and optional operations retained |
| Approvals | Failed/unverified label beside exact revision, named missing/failed checks and explicit risk acknowledgement |
| Recovery | Existing Resume/Stop/Keep branch/revert behavior; truthful failure and restoration limits |
| Accounts | Install/sign-in instructions before technical capability details; no Hydra credential entry |
| Phone | Off by default; HTTP client-integrity limitation prominent; pairing/scopes/revocation preserved |
| Settings | Themes, quality, drafts, local data, updates and local suggestions retained; retention/containment copy corrected |

## Safety and remaining work

Project checks run as the user. There is no qualified hostile-repository container. Worktrees isolate changes for Git delivery, not arbitrary host reads or networking. CLI restrictions vary by provider/platform. The UI risk acknowledgement is a product safeguard; existing API acceptance policy is unchanged and exact-SHA enforcement remains server-side.

Deletion removes task projections and logs but retains journal events and pre-existing backups/exports. No comprehensive purge was added. Secure erasure, journal retention/compaction, asynchronous backup and restoration need a separate lifecycle design. Never silently delete backups to satisfy a vague erasure claim.

Boot snapshots cap full task records at 100 and prioritize running/queued/waiting work. They are not summary-only or a complete action inbox. In unusually large pending queues, project History is the authoritative paged path. Task bodies and journal entries retain existing schema limits; replay is bounded by batch count and outbound bytes, not total journal retention. Search can still scan the project history in SQLite. Large-history performance beyond the executed regression remains unqualified.

No provider prewarm on composer focus; typing/focus should not start a provider process. Collapsed operations are unmounted; approval waiting has no drawing clock. Whole-process CPU, 8-hour soak, mixed-platform packaged acceptance, screen-reader and novice comprehension studies remain qualification work.

## Skills and review

Actually read: Impeccable 4.6.0 SKILL.md plus new-work/craft-floor/Operate guidance; Emil design engineering; design-taste-frontend; high-end-visual-design. Written Impeccable guidance informed hierarchy, disclosures, states, contrast and rendered review. Emil informed short existing transitions, reduced motion and idle work. Taste's subject-specific concept principle informed the receipt. Its website-only direction dealer and high-end's mandatory glass/massive-motion prescriptions were skipped because they conflict with a daily desktop work surface and this brief. No design binary, script, hook, download or added dependency ran. No image generation was needed for functional evidence.

Codex is the implementation writer and verifier. A separate read-only Codex subagent consulted on concepts and source risks under AI_TEAM.md. It did not edit or run providers. This does not claim a separate Claude review or external certification.
