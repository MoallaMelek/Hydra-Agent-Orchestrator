# Decisions

- Target v2, which is installed and has newer security/isolation work; preserve both older source and newer redesign branches.
- Keep Relay as the shared event model. Compare actual spatial workspaces, timeline and artifact-path views against the same recorded real-agent run. Default to workspaces for responsibilities, retain timeline/replay and exact evidence for deeper exploration.
- Preserve actual concurrency semantics: agents overlap across tasks; each task's planning/implementation/review/check stages remain sequential. Never draw imaginary within-task parallel execution.
- Persist draft content, attachments and routing above navigation boundaries, on a stable desktop file path independent of hydrad's random port. Coalesce pending disk writes and await the final snapshot on normal close/restart. Keep explicit recovery/discard controls.
- Preserve the engine's no-network-client invariant. Signed metadata/hash handling remains in the engine library; bounded HTTPS transport and installation belong to the Electron host.
- Extend the existing Ed25519 signed-manifest foundation instead of installing another updater dependency. A compiled public key pins publisher trust; channel/version/platform/size/hash checks precede an explicitly requested NSIS installation. The prepared release workflow additionally requires Authenticode signing.
- Restart requires an inert renderer, successful draft persistence, no unsent work, an engine-side expiring maintenance lease, a consistent SQLite backup, revalidation immediately before launch, and confirmed engine exit before arming the helper. Failed preparation cannot block work indefinitely.
- Keep the same v2 app identity, install location, engine data layout and OS-managed provider sign-ins. A previous backup plus retained verified installer is recovery assistance; automatic binary/database rollback is not claimed.
- CI runs only on owner dispatch. Signing is behind the `windows-updates` environment; the owner must configure its required reviewers. Actions are pinned to verified upstream revisions. The workflow stages draft releases and never publishes or advances a channel tag.
