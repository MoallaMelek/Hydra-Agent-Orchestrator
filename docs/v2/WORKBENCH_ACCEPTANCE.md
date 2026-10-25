# Workbench acceptance — 16 October 2026

Base `cc78c306cad6359f95d815190b60dbc8a4a719c8`; implementation branch `feat/hydra-workbench-updates`. The owner delegated the choice between the old audited 0.2.61 source and installed v2. Target v2; preserve both original checkouts, unrelated files and installed data.

## Implemented and exercised

- Durable device-local project/follow-up/feedback drafts, bounded text/code attachments, visible routing/mode and theme initialization. Native preference writes are atomic, coalesced and awaited before close/update. Recovery is exposed in Settings. Keyboard submission checks readiness and duplicate submissions.
- Three views over genuine coordinator records: Workspaces (roles/ownership), Timeline (recorded time/concurrency), Evidence path (artifacts/handoffs). They preserve observed versus inferred semantics. Replay does not reveal future run outcomes or pretend historical streaming text exists. Frozen selections do not leak across tasks.
- Three semantic theme palettes; no new animation loop/library. Existing batching, selector subscriptions and adaptive quality retained. Late answers from finished attempts are ignored, including after retry/cancel; bounded caches.
- Desktop update state machine, bounded secure HTTPS transport, signed manifest/hash checks, real byte progress, optional background downloads, explicit restart, unsaved-work refusal, expiring maintenance barrier and consistent backup. Native helper only starts after engine exit. Protected owner-dispatched Windows build/draft-release workflow.

## Evidence

`npm run check`: 35 files passed, 287 tests passed and 1 skipped; typecheck/lint/provenance passed (163.94 s). `npm run build` passed. No dependency was added. UI JS: 557.52 kB / 174.83 kB gzip; Vite emits a >500 kB chunk warning.

`npm run e2e:desktop -- --simulate-missing-providers`: seven native steps passed, including onboarding, project creation, distinct drafts/attachment through theme/project/navigation/reload, check-error reporting, backup/export, engine shutdown and relaunch persistence. Real Tab produced a visible two-ring focus style. Native renderer screenshots and machine reports accompany the local delivery, not this repository.

`tools/relay-real.mjs`: two real Claude/Codex change tasks in disposable repositories both reached final approval; actual execution overlap 74 s / elapsed 103 s. Each task follows ordered stages; concurrency across tasks is real. Their engine-run checks passed; expected failing baseline demonstration is retained distinctly. `tools/capture-recorded-run.mjs` inspected those same saved records in three views, three themes and 390 px width, without starting tasks or changing decisions. Historical replay/freeze isolation checks passed.

Ten samples/version, alternating five-sample baseline/redesign blocks, 13,518 simulated events/sample: median complete scenario 4,906 → 4,896 ms, average frame 10.10 → 9.55 ms, worst frame 71 → 71 ms, one long task in both medians. Deterministic exploratory bootstrap interval for median wall-time difference: −564 to +207 ms. No established speed difference or universal equivalence. Default views differ (timeline/workspaces), DOM 379 → 281. Rounded heap deltas do not prove no leak. Solid token contrast: 63 pairs, all ≥4.5:1; alpha blends and full accessibility audit excluded.

## Acceptance gaps — do not call the entire mandate complete

Five alternating startup/idle observations per version: rendered median 1,971 → 1,998 ms; working set 448.2 → 450.8 MiB; private memory 262.2 → 260.2 MiB. CPU median 1.02 → 3.61% of one core, ranges 0.17–3.41 → 0.43–7.36%; last two observations used longer warmup/windows. Exploratory same-machine data, no established regression/equivalence. **Idle CPU acceptance remains open.** A paired CPU profile recorded zero DOM mutations and 99.603% / 99.587% JS idle samples; no repeating application render loop identified, native Chromium/OS CPU unresolved. Profiling overhead means profiled/unprofiled totals must not be compared. Codex dollar cost is unreported; do not interpret reported cost as a full account bill.

On 17 October, the owner-authorized unsigned local alpha.1 NSIS migration replaced the previous installed alpha.0 in place. The new desktop bridge and pinned public publisher configuration are present. A DPAPI-protected local publisher key and isolated NSIS test environment are now provisioned. Actual disposable alpha.0 → alpha.1 install/helper/restart and data survival passed, as did corrupted-package refusal/relaunch. The real installed app retained its database, project, four tasks and provider sign-in; shell/engine health and screenshots verified. **Real signed-release discovery/download/click acceptance, Authenticode certificate, protected release provisioning and partial-installer rollback remain UNVERIFIED.** OS launcher startup needs a separate deadline for exceptional OS/AV stalls. See [Windows update release gate](WINDOWS_UPDATES.md). No public release, tag, deployment or GitHub secret was modified.

All ten final product questions remain bounded by evidence: actual state/concurrent task distinction/exact evidence have recorded proof; first-minute comprehension, handoff/approval understanding and superiority require real participants. Draft recovery is exercised; full provider-outage/repair/cancel visual matrix remains open. Shared identity/tokens extend existing v2 screens, but complete legacy editor, interactive terminal and standalone Usage parity is not restored. Three operational representations are rendered alternatives, not a completed whole-product art-direction user study. Physical Mac/phone, screen readers, large persisted history and hour-long soak remain unverified. Native OS chrome is retained; no Mac drag behavior is claimed.

Explicit heuristic walkthroughs: beginner setup → task → named duties → review; intermediate independent drafts → navigation → recovery; expert operation → artifact/check → historical replay → exact revision. Automated scenarios support these journeys but establish no human task/comprehension times or comparative preference.

## Method and ownership

This Codex chat wrote/integrated/tested; a fresh read-only consultant made two bounded review passes. Findings addressed draft/replay identity, keyboard guards, update races, expiring barriers, close-flush, helper ordering and protected signing. No reciprocal CLI partnership is claimed.

Accessible Impeccable passive craft/operate, Taste Skill, Emil design engineering and Vercel React performance guidance influenced semantic hierarchy, role-first composition, purposeful interaction/reduced motion and bounded subscriptions. Marketing recipes, experimental variants, image-generation workflows and unsafe skill runtimes were skipped. No automatic installation, unreviewed hook, bypass or unknown binary ran. The earlier independent 0.2 audits were used as a backlog, not proof that identical defects exist in v2. No invented perfection score.
