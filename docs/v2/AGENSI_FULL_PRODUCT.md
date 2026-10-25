# Full Hydra distribution and Agensi — unpublished draft

Checked 2026-10-17. No account, payout setup, submission, publication, contact or purchase performed.

## Platform evidence

[Agensi Terms](https://www.agensi.io/terms), updated October 12, 2026: 18+ eligibility; creator account and enabled payout method for paid listings; ZIP submissions containing valid SKILL.md; automated scan and manual review; accurate authorship/functionality claims. Delivery is through the agent connection, with no buyer file download. Listings and packages may not promote paid off-platform products; documentation, websites and source-repository links are allowed. Current net split is 70% creator / 30% platform. Country-specific payout eligibility remains unverified.

[Creator guide](https://www.agensi.io/learn/how-to-sell-skills-on-agensi): Creator Dashboard takes the ZIP, description, tags and price; approved skills enter discovery. The guide's onboarding and payout wording should be checked against current terms and actual dashboard before submission.

[Seller page](https://www.agensi.io/sell): skill files load through MCP into the connected agent. The page describes one-time, subscription and bundle offerings, and security/intent review. It does not establish a desktop installer delivery channel.

**Decision:** no documented support found for distributing the full Electron binary as an Agensi product. This is a conclusion about the documented delivery mechanism, not proof that Agensi would reject a negotiated partnership. Do not upload an installer disguised as a skill. Desktop-binary support, external-free-app references and any partnership terms require platform confirmation before listing.

## Full application packaging

Hydra remains a separate desktop product with its real engine, Git worktrees, Claude Code/Codex CLI integration, local database, human approvals and update system. Prepare a versioned signed installer per qualified operating system, trusted release metadata, checksums, provenance, support contract, data/restore guide and clear provider requirements. Host/distribute only after owner approval. Keep support and updates tied to the application version. No pricing, license, entitlement server or payment integration is selected in this milestone.

The app's core promise: **Describe the change. Inspect the evidence. Decide what reaches your project.** It coordinates real CLI agents with the user's own accounts. Within one task, the current engine stages the work; separate tasks can overlap. It does not sell model access, guarantee correctness, provide hostile-code containment, or currently offer a qualified public release service.

## Compliant Agensi companion proposal

Treat a companion as a useful independent skill: a change brief and evidence-review method that works in an existing supported coding agent. No automatic Hydra installation, shell downloader, API token extraction, localhost privilege bridge, paid app upgrade, licensing workaround or hidden network call. Existing standalone skills in `skills/` are candidate source material, not approved listings. Re-review ownership, safety, current platform rules and actual agent execution before packaging.

Discovery may identify the author and method and refer to permitted documentation/source, without promoting a paid desktop product. If Hydra becomes paid, remove promotional links or obtain explicit platform permission before using any related reference. Agensi purchases would grant access to the companion skill under its platform terms, not a desktop application license. A companion cannot be represented as the full Hydra app.

## Draft full-app listing (for an owner-approved desktop channel)

**Name:** Hydra — AI engineering with a clear decision trail

**Short description:** Bring your own Claude Code or Codex account. Ask about a project or request a change, inspect the work and recorded checks, then decide what reaches your branch.

**Description:** Hydra is a local desktop workspace for supervised AI engineering. Change tasks get their own Git worktree. The engine coordinates planning, implementation, review and check commands, retaining the proposed revision and observed results. A mission receipt puts checks, review and the next decision together. Your approval controls delivery to the project. Failed and missing checks remain visible. Questions use a simpler conversation with follow-ups. Local history and exports help you return to earlier work.

**Preview requirements:** Git for changes; a supported installed/signed-in provider CLI and provider account; trusted repositories; supported OS qualified by the release checklist. Provider billing/limits remain with the provider. Unsigned local builds and unqualified recovery/remote boundaries must be disclosed. No uptime, cost, success-rate or speed guarantees.

## Draft Agensi companion listing

**Name:** Hydra Change Brief & Evidence Review

**Summary:** Turn a coding request into a reviewable brief and a checklist of observed evidence inside your existing agent.

**Description:** A proposed independent method for clarifying a change, recording acceptance criteria, separating observed checks from assumptions, and preparing an exact-revision human decision. Requires a supported coding agent and access to the intended repository. It is instructional guidance, not an enforcement boundary. It does not include or install the Hydra desktop application. Compatibility, final package content, rights, pricing and execution qualification are pending.

Proposed tags: engineering-workflow, change-review, verification, git, human-approval. No paid-app link, price or compatibility claim is approved for publication.

## Onboarding and demo plan

1. Explain accounts: Hydra connects to installed CLIs; the customer signs in there. No API key form in Hydra.
2. Select a trusted disposable Git project; explain that uncommitted source changes are not copied into a task worktree.
3. Ask a code question. Identify selected repository separately from runtime identity.
4. Request a small change in Safe mode; inspect and approve the plan and exact commands.
5. Show a real recorded operation, open the changed file, then compare the check result and revision.
6. Demonstrate failed/no-check approval language before showing a passing task. Apply only a disposable fixture, then demonstrate revert-based rollback.
7. Reopen History, recover an interrupted task, inspect data retention and leave phone access off.

Capture 45–90 seconds of actual packaged UI. Retain a continuous take and version/commit/profile details. Label scripted fixtures as scripted; label recorded provider activity as recorded. Never present archived output as current live activity. Screenshots: first run, accounts, composer, running work with details, pass/fail/unverified receipt, recovery, history/search, data/update settings, and phone limitations. Include dark/light and narrow-window views. No synthetic customer logos, testimonials, ratings or manufactured benchmark claims.

## Versioned release checklist

Candidate identity: alpha.3 plus this feature branch; no version bump/tag or release created here. The owner chooses the next release version after qualification.

- Freeze source SHA, lockfile, dependency inventory, provenance, license report and supported CLI versions; run check/build/artifact scan on each target OS. Audit shipped dependencies against current advisories before release.
- Resolve application/skill license and trademark/name decisions; preserve third-party notices. Nothing here changes a license.
- Provision and review Windows Authenticode, Apple Developer ID/notarization and the signed-manifest trust-anchor/key recovery/rotation process. Secrets stay outside the repository.
- Approve HTTPS hosting and feeds; test installed old → signed manifest → download → explicit restart → new version with retained data. A local unsigned package is not a signed-feed result.
- Run network interruption, disk-full, permission/AV failure, helper stall, partial-install, corrupt metadata and key-rotation drills on disposable profiles.
- Demonstrate restoration using a version-matched data/profile backup and known-good installer. Do not promise automatic rollback of partially overwritten program files or incompatible schemas.
- Qualify host execution scope or a real containment profile; no hostile-repository marketing before escape/network/credential-read tests.
- Qualify trusted client delivery before hostile-network remote claims; physical phone and assistive testing required.
- Run repeated idle/startup/multi-task/history/slow-client/soak measurements; publish scope and failures. Recruit/invite testers only after owner approval.
- Owner approval required for pricing, distribution, submission, publication, deployment, spending, license changes, tester invitations and merging to main.

Until those gates pass, position the entire app as a supervised local developer preview. The companion strategy is optional discovery, never a replacement for shipping the full product responsibly.
