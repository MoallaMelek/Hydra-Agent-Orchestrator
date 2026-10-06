# Decisions

- Canonical tasks live in the detached daemon and persist independently of renderer lifetime. Existing interactive agents remain available in Agents.
- One writer lease per canonical project root; parallel work is independently read-only. Review and repair have explicit budgets.
- CLI account authentication stays in provider processes. No model API replacement.
- Claude uses restricted Read/Glob/Grep tools for inspection and additionally Write/Edit for approved project changes. Real tests demonstrated scoped writes and rejection of outside writes. This is file-tool confinement, not an OS sandbox. Codex provides shell verification in its workspace sandbox; Claude-only completion explicitly limits verification to observed file reads. Autonomous writing requires Codex.
- Safe requires task-specific upfront approval for project writes. Developer permits bounded project writes; Autonomous uses the same sandbox with a larger execution budget. No mode permits bypass flags, deployment, pushes, or external approvals.
- Provider command results are observed evidence, distinct from model assertions. Missing verification or unresolved review cannot become a verified completion.
- Remote consequential approvals remain local; no Firebase deployment or authorization expansion.

- Codex task invocations preserve authenticated user configuration and deny rules. The installed CLI unexpectedly selected read-only with --ignore-user-config even when workspace-write was requested; real write probes verified explicit -s without that flag. Apps, plugins, hooks, multi-agent tools and configured user MCP servers are disabled per task invocation, with network and temporary-write exclusions explicit.
- Daemon task protocol 2 upgrades idle older daemons gracefully and preserves busy daemons with visible upgrade guidance. Stable client transport adoption handles crash/token rotation without replaying interrupted writes.
- Reviewer findings fixed: cancellation after asynchronous discovery/root validation, question routing, synthesis streaming, attachment false positives, headless/interactive writer exclusion, quoted-shell check evidence, and POSIX process-group escalation.
