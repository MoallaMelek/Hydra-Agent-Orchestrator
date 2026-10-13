# Agensi skill audit, listings and pricing (draft — NOT submitted)

Nothing has been submitted to Agensi. Submitting, pricing and publishing need the owner's approval. Market data below comes from read-only Agensi searches on 2026-10-13.

## 1. Audit of the three skills in `skills/`

| Skill | Purpose | Independence | Quality findings | Fixed now | Status |
|---|---|---|---|---|---|
| `evidence-based-verification` | Detect a project's real checks, run them, report exit codes against the exact commit; never claim "tests pass" without evidence | Written from scratch; no Hydra dependency (it only optionally honours `.hydra/checks.json`) | (1) It suggested `git stash` for before/after runs; a shared stash can collide with other tools. (2) The helper script printed "No checks detected" for a nonexistent directory. | Both fixed: temporary worktree only; exit 2 with an error for a missing directory | Ready to list (owner approval) |
| `independent-code-review` | Structured, severity-ranked review against the request; treats repo text as data; JSON verdict; encourages a different model as reviewer | Same | Sound. It depends on the reviewer agent having the diff; it says so. Cross-references the verification skill, which degrades gracefully if that skill is absent. | — | Ready |
| `isolated-change-workflow` | Plan → worktree → implement → review → verify → present → apply only on accept → revert-based rollback | Same | Sound and non-destructive (no reset, no force-push, refuses dirty trees). Manual: it relies on the agent following the steps; nothing enforces them (that is what the Hydra app adds). | — | Ready |

Checks performed: read all three SKILL.md files in full; ran `detect-checks.mjs` on this repository (Node), on a Python+Go fixture and on a missing path. Not performed: an end-to-end run of each skill inside Claude Code or Codex on a third-party repository (OPEN before submission).

Before submission (owner): choose a licence for the skills (they can differ from the app; MIT or a simple commercial licence), confirm the creator name, and decide whether to mention Hydra in listings.

## 2. Market snapshot (Agensi, 2026-10-13)

| Comparable listing | Price | Installs |
|---|---|---|
| Verify Before Done | free | 0 |
| verify-before-shipping | free | 6 |
| Verification-Before-Done | $5 | 0 |
| Code Review Specialist / Code Review | $5 | 0 |
| code review excellence / AI-Loop Independent Verification | $8 | 0 |
| adversarial code review / Security Code Review | $9 | 0 |
| claude-code-review-gate | $14.99 | 0 |
| Git Worktree Manager | $8.99 | 0 |
| approval-gated-writes | $69.96 | 0 |

Reading: the categories are crowded, and installs are close to zero for paid and free listings alike. Expect low direct revenue; the skills are most valuable as a credible, low-cost entry point that demonstrates the same discipline the Hydra app enforces.

## 3. Proposed listings

### evidence-based-verification — **Free** (recommended)
- **Name:** Evidence-Based Verification — no "tests pass" without proof
- **Tagline (≤140):** Detects your project's real build, lint and test commands, runs them and reports exit codes against the exact commit. No evidence, no "done".
- **Tags:** verification, testing, quality-gate, claude-code, codex, ai-agents
- **Description:** AI agents often say "tests pass" without running anything. This skill makes the agent find the project's own checks (Node, Python, Go, Rust, Java, C/C++, or a declared check list), run them, and report each command with its exit code, duration and commit SHA. A check that modifies tracked files is flagged as untrustworthy evidence. Anything not run is reported as NOT RUN, never as a pass. Includes a read-only helper script that prints the detected commands without executing them.
- **Why free:** two free competitors exist; a free, high-quality listing builds trust for the paid ones.

### independent-code-review — **$5**
- **Name:** Independent Code Review — severity-ranked verdict, cross-model ready
- **Tagline:** Review AI-written changes as an outsider: checks the request, the diff and real evidence, flags weakened tests, returns a JSON verdict.
- **Tags:** code-review, ai-agents, security, testing, claude-code, codex
- **Description:** Reviews a diff, branch or pull request against what was actually asked. It reads the surrounding code, treats repository text as data (prompt-injection resistant), checks for weakened or deleted tests, scope creep and common security issues, and returns a structured verdict (blocker, major, minor, nit) with acceptance criteria marked met or unmet. It approves only with no blocker or major findings. Built to be run by a different model than the one that wrote the code (for example Codex reviewing Claude's work, or the reverse).

### isolated-change-workflow — **$7**
- **Name:** Isolated Change Workflow — worktree, verify, approve, then apply
- **Tagline:** Your branch stays untouched until you approve a verified commit. Fast-forward apply, re-verify if your branch moved, revert-based rollback.
- **Tags:** git, git-worktree, workflow-automation, human-in-the-loop, agent-safety, claude-code
- **Description:** A step-by-step protocol for agents changing real repositories: plan read-only, implement in a separate git worktree, review, verify with real checks, then present the diff, evidence and risks for an explicit accept, request-changes or reject. On accept it fast-forwards, or integrates and re-verifies if your branch moved. It never resets, force-pushes or stashes your work, and rollback is a revert commit.

### Bundle (optional) — **$10**
- **Name:** Supervised AI Changes Kit (all three skills)

## 4. Positioning relative to the Hydra app
The skills describe the discipline; the Hydra desktop app enforces it (engine-run checks, worktree isolation, approval bound to the reviewed commit, budgets). A listing may say: "Want this enforced rather than followed? See Hydra." Only do that after the name and trademark decision, and never imply that Anthropic or OpenAI endorse it.

## 5. Owner decisions needed
1. Approve submission (nothing is submitted).
2. Prices: free / $5 / $7 / bundle $10 as proposed, or other.
3. Licence for the skills.
4. Whether to mention Hydra in the listings.
