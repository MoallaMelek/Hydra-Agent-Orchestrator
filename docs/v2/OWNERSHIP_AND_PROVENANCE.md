# Ownership and Provenance — Hydra v2

Status: **living document**. Last updated at each milestone (see PROGRESS.md).

## 1. History of this repository (accurate account)

| Period | What happened | Authorship |
|---|---|---|
| 2026-02 → 2026-05 | `jpdlr/hydra` developed publicly by its author (MIT). 268 commits. | Upstream author |
| 2026-05-11 | Upstream commit `d8ad561` became the starting point of this repository. | Upstream author |
| 2026-09-12 → 2026-10-12 | Fork-specific changes under Melek Moalla's direction: coordinated task pipeline, provider confinement, remote hardening, security tests (~3,517 TS lines added, ~695 removed, against ~32,105 inherited TS lines). Implemented mainly by Codex CLI and Claude Code sessions directed by the owner. | Melek Moalla (direction) + AI coding agents, on top of upstream code |
| 2026-10-12 | Independent technical audit (`HYDRA_Technical_Audit_Report.pdf`, `HYDRA_AUDIT_BACKLOG.md`). | Claude Opus 5.5 |
| 2026-10-13 → | **Hydra v2**: a new codebase written from product requirements on branch `v2-rebuild`. | Melek Moalla (direction, product owner) + Claude Opus 5.5 (implementation), see §4 |

Archive points:
- Tag `legacy-v0.2.61` → `66972118188dea2167407bb6dc8830ecd044711f`, the last commit of the legacy line on `main`.
- `main` is untouched. The legacy files on `v2-rebuild` were moved with `git mv` to `legacy/`, so their history is preserved. They are not deleted.

## 2. What is legacy and must keep its notices

Everything under `legacy/` is the legacy implementation, including `legacy/LICENSE`, which carries both copyright lines (`MelekCreed` and `jpdlr`). It is MIT-licensed. Those notices must be kept in any redistribution of the legacy code. Nothing in `legacy/` is built, imported, bundled, linted or tested by v2:
- the v2 workspaces are listed explicitly in the root `package.json` (`packages/*`, `apps/*`);
- `tools/provenance-check.mjs` fails CI if any v2 source imports from `legacy/`, and reports textual similarity between v2 sources and legacy sources.

## 3. Brand assets

All legacy logos and icons (`legacy/assets/hydra*.png`, `legacy/build/icon.*`, `legacy/src/assets/*.svg`) exist in the upstream repository at the fork point. They are **not reused**. Hydra v2 has a new mark, drawn from scratch as SVG for v2 (`packages/ui/src/brand/HydraMark.tsx`, `assets/brand/`). The name "Hydra" is kept because it is the owner's project name. Note: "Hydra" is a common word and the upstream project uses the same name; no trademark clearance has been done (see §6).

## 4. Clean-room process used for v2 (and its honest limits)

- v2 was designed from **product requirements** (the owner's brief) and from the audit's **problem list**, not from legacy source files.
- The implementer (Claude Opus 5.5) read parts of the legacy code during the audit on 2026-10-12. That is prior exposure, so this is **"clean-room-inspired"**, not a formal clean-room with separated teams. During v2 implementation, no legacy file was opened as a reference for writing v2 code, and nothing was copied, translated or paraphrased.
- Architecture deliberately differs: an engine-first daemon with an event-sourced SQLite journal; isolation through git worktrees; verification **executed by the engine itself** rather than parsed from agent output; a zero-knowledge end-to-end-encrypted relay instead of Firebase; a single UI used by the desktop shell and the phone. See ARCHITECTURE.md and DECISIONS.md.
- Objective evidence: `npm run provenance` computes normalized 6-line shingle overlap between every v2 source file and every legacy source file. Results are recorded in TEST_EVIDENCE.md at each milestone.

## 5. Third-party components

Third-party libraries are used under their licences. `docs/v2/THIRD_PARTY.md` is generated from the installed dependency tree (`npm run licenses`). Hydra v2 does not claim ownership of Claude, Claude Code, Codex, OpenAI or Anthropic trademarks, or any dependency.

## 6. Open questions for the owner (need your decision or professional advice)

1. **Licence for v2.** No licence file is committed for v2 yet. A public repository without a licence is "all rights reserved" by default. Options: MIT/Apache-2.0 (open), a source-available licence (e.g. FSL/BUSL) or proprietary. This is a business decision; ask a lawyer if you plan to sell it.
2. **AI-generated code.** Copyright protection for code generated largely by AI may be limited in some jurisdictions; human direction, selection and arrangement matter. Do not claim exclusive IP solely on this basis without advice.
3. **Name and trademark.** "Hydra" is used by the upstream project and many unrelated products. Check before commercial use.
4. **Statement you can truthfully make today:** "Hydra v2 is a new codebase with an original architecture, designed under my direction and implemented with AI coding assistance; it replaces an earlier version that was based on the open-source jpdlr/hydra project." Do not describe the legacy versions as independently authored.
