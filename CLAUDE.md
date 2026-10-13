# Hydra — instructions for AI coding agents

- Read `docs/v2/HANDOFF.md` first, then `docs/v2/ARCHITECTURE.md` and `docs/v2/DECISIONS.md`.
- Keep the codebase original: write code yourself; never copy code from other projects or paste it from the web. `npm run provenance` (originality check) must pass.
- Never force-push, rewrite history, merge into `main`, publish releases or deploy infrastructure without the owner's explicit approval.
- Before committing: `npm run check` must pass. Record new evidence in `docs/v2/TEST_EVIDENCE.md` and progress in `docs/v2/PROGRESS.md`.
- Never claim a feature works without observed evidence. Mark untested things UNVERIFIED or BLOCKED.
- Hydra must never handle provider credentials (D-012) and must not depend on any cloud database (D-011).
- Collaboration with Codex follows `AI_TEAM.md`.
