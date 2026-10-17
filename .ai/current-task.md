# Hydra workbench and safe desktop updates — 16 October 2026

Writer/integrator/tester: this Codex chat. Consultant: a fresh, read-only Codex subagent; no edit ownership was delegated. Two bounded review passes identified state and updater lifecycle issues; the findings were integrated centrally.

Feature branch: `feat/hydra-workbench-updates`, based on `cc78c306cad6359f95d815190b60dbc8a4a719c8` (`redesign/live-operations`). The Desktop source checkout remains at the older audited revision; it was not reset or merged. The v2 checkout and its unrelated `.claude/` files were preserved.

Decision: target the installed v2 architecture, after the owner delegated that choice. Reuse and extend its Relay view, isolated worktrees, engine-run checks, durable history and approvals. Do not revive a competing 0.2 release. The old audit remains a defect/acceptance checklist, not proof that the same defects exist in v2.

Implementation: persistent device-local drafts/attachments/routing and saved-draft recovery; three themes; guarded keyboard submission; task-keyed freeze/replay; historical status correctness; bounded streaming caches; spatial workspaces, timeline and evidence path over the same records; Windows signed-manifest update lifecycle, coalesced persistence, engine maintenance leases, backup and deferred NSIS handoff; protected build/draft-release workflow.

17 October continuation: owner explicitly authorized replacing the installed application and confirmed Hydra closed/work saved. Provisioned a local DPAPI-protected Ed25519 publisher key, embedded only public configuration, built alpha.1 and tested a separately registered disposable NSIS alpha.0 → alpha.1 upgrade/restart. Fixed reproduced PowerShell detached-start failure with an OS hidden launcher and readiness acknowledgment; preserved explicit data-directory overrides. Corrupted installer bytes were refused, previous alpha.1 relaunched, disposable data survived. Full check 288 passed/1 skipped; packaged native seven-step acceptance and 84-file artifact scan passed.

Actual installed Hydra replaced in place at its original per-user path: shell and engine alpha.1, one project/four tasks retained, both providers authenticated. Installer left the database byte-identical; persisted projects/tasks/runs/evidence/devices/remote commands/outcomes/settings rows unchanged after launch. Full previous application, engine and desktop-profile backup retained under restricted LocalAppData/Hydra/migration-backups. App reopened normally after inspection.

Not authorized/performed: public releases/tags/deployment, merging main, GitHub secret changes or Authenticode provisioning. Local migration remains unsigned; signed-release discovery/download/click acceptance and partially failed NSIS rollback are unverified. Broad redesign acceptance gaps remain documented; do not claim the entire mandate complete.
