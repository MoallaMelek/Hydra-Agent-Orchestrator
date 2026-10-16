# Hydra workbench and safe desktop updates — 16 October 2026

Writer/integrator/tester: this Codex chat. Consultant: a fresh, read-only Codex subagent; no edit ownership was delegated. Two bounded review passes identified state and updater lifecycle issues; the findings were integrated centrally.

Feature branch: `feat/hydra-workbench-updates`, based on `cc78c306cad6359f95d815190b60dbc8a4a719c8` (`redesign/live-operations`). The Desktop source checkout remains at the older audited revision; it was not reset or merged. The v2 checkout and its unrelated `.claude/` files were preserved.

Decision: target the installed v2 architecture, after the owner delegated that choice. Reuse and extend its Relay view, isolated worktrees, engine-run checks, durable history and approvals. Do not revive a competing 0.2 release. The old audit remains a defect/acceptance checklist, not proof that the same defects exist in v2.

Implementation: persistent device-local drafts/attachments/routing and saved-draft recovery; three themes; guarded keyboard submission; task-keyed freeze/replay; historical status correctness; bounded streaming caches; spatial workspaces, timeline and evidence path over the same records; Windows signed-manifest update lifecycle, coalesced persistence, engine maintenance leases, backup and deferred NSIS handoff; protected build/draft-release workflow.

Not authorized/performed: publishing releases, merging main, deploying updates, changing secrets, generating publisher keys, replacing the installed app. Real version-to-version NSIS acceptance remains blocked on provisioned trusted releases and an isolated installer test environment. Do not call helper/controller tests a real installation test.
