# Hydra v2 — instructions for AI coding agents

- Read `docs/v2/HANDOFF.md` first, then `docs/v2/ARCHITECTURE.md` and `docs/v2/DECISIONS.md`.
- **Never read, copy, translate or paraphrase anything under `legacy/`** when writing v2 code. v2 must stay independently authored. `npm run provenance` enforces this.
- Work only on branch `v2-rebuild`. Never force-push, rewrite history, merge into `main`, publish releases or deploy infrastructure without the owner's explicit approval.
- Before committing: `npm run check` must pass. Record new evidence in `docs/v2/TEST_EVIDENCE.md` and progress in `docs/v2/PROGRESS.md`.
- Never claim a feature works without observed evidence. Mark untested things UNVERIFIED or BLOCKED.
- Hydra must never handle provider credentials (D-012) and must not depend on any cloud database (D-011).
- Collaboration with Codex follows `AI_TEAM.md`.
