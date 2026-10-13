# Progress log — Hydra v2

Newest entry first. Each entry: date · branch@commit · what changed · test state · known defects · next action.

## 2026-10-13 · v2-rebuild · Milestone 0 complete, Milestone 1 core complete
- Repository: tag `legacy-v0.2.61` (6697211) created locally; worktree `C:\Users\moall\hydra-v2` on branch `v2-rebuild`; legacy moved to `legacy/` with `git mv`.
- Docs: OWNERSHIP_AND_PROVENANCE, ARCHITECTURE, DECISIONS (D-001…D-012), THREAT_MODEL, ROADMAP.
- Code: `packages/protocol` (domain, commands, events, API types); `packages/engine` (SQLite store with journal and migrations, pure workflow machine, policy and budgets, Claude/Codex/scripted adapters, auth detection, git worktree isolation, multi-ecosystem verification detectors and runner, prompts and strict schemas, orchestrator with all 7 stages plus apply, rollback, recovery, Engine facade).
- Tests: 42/42; lint and types clean; provenance overlap 0%.
- Owner requirements added mid-session: D-011 (backend ownership, $0, no cloud DB) and D-012 (customer auth and billing isolation) are implemented in the engine (auth probes keep only a boolean; DB credential scan test).
- Known gaps: live CLI acceptance pending; hydrad/UI/desktop/remote not started.
- Next: live end-to-end with real Claude and Codex on a temp fixture; then hydrad API.
