# Conversation, scrolling and source context — alpha.3

The owner reported that alpha.2 changed mainly the first screen, showed a large blank tail after a conversation, and answered self-analysis using the old Hydra architecture. All three observations were valid. There was no completed all-screen design hidden in another installer.

## Reproduced causes

Native Electron geometry over a consistent copy of the owner's completed history showed a 754px viewport with a 1,945px document scroll height, in addition to a separately scrolling main workspace. The outer document could scroll 1,191px beyond the application frame. The fix bounds the shell to the viewport, contains root overflow only when a shell exists, and retains main/inspector scrolling. Remote authentication pages without a shell retain their own document behavior.

The selected project is `C:\Users\moall\OneDrive\Desktop\Projects\hydra`, at `3699b250ae2b3af5bb26f8066ef1d0d18fd0a256`, package version 0.2.61. The installed application was alpha.2. Analysis correctly ran in the selected repository, but the prompt encouraged speaking as Hydra without distinguishing selected code from the running product. No installed binary/source identity was provided.

## Implementation

- Conversation view now uses a reading document, explicit selected-folder/runtime strip, recorded-answer labels, execution/source inspector and grouped reply/attachment composer. Existing history, drafts and actions remain on their existing mechanisms.
- Source context is an optional backwards-compatible Task field. The host captures selected root and runtime version; future analysis prompts receive trusted runtime version separately from JSON-encoded path data in the existing untrusted wrapper. They explicitly forbid equating repository findings with installed architecture or silently switching checkouts.
- A successful replacement answer and its provenance are committed atomically. A failed resumed attempt retains its previous answer/context. Historical answers without recorded context remain explicitly unknown, not backfilled or rewritten.
- Settings, Providers, Remote, Project and change-task workspaces received corresponding surface/layout treatment. Safe Markdown rendering replaces raw syntax in home previews. No new dependency or animation clock was added.

## Evidence

Full check: 35 files, 289 passed/1 skipped, typecheck/lint/provenance; 123.54s. Focused conversation tests include actual adapter cwd/access/prompt/provenance and failed-retry retention. Final types/lint, build, Windows NSIS packaging and seven packaged native checks passed. Artifact scanner: 84 resource files passed. JS gzip 176.88kB; CSS gzip 11.03kB. Existing large-chunk warning remains; these sizes and layout checks are not a CPU/memory equivalence benchmark.

Native Electron captures cover the original long conversation at top/bottom, expanded details, three themes, 390px width without document overflow, Agents/Remote/Settings, and actual recorded change workspaces/replay/freeze. Document height now equals viewport height (754px), while the conversation remains fully scrollable inside main. Existing task records remained unchanged in inspection.

Automatic approval initially refused the optional real-provider test for lack of approval for that repository payload. The owner explicitly approved one read-only Claude validation capped at $0.50; only then did it run. It completed in a disposable copy of task data, distinguished host runtime alpha.3 from selected repository 0.2.61, and explicitly denied that the checkout proved installed architecture. Reported cost $0.0390898. This observed response does not guarantee compliance of every future model answer.

Actual installed shell, UI and engine payload hashes were matched against the tested build. Alpha.3 installed over the closed alpha.2 with NSIS exit 0; database was byte-identical before first launch. One project/five tasks, provider sign-ins and all eight compared persisted tables survived. Fresh restricted application/engine/profile backup retained locally; app reopened normally. No public release, secret change, deployment or main merge.

## Review and limits

Root wrote/integrated/tested. A fresh read-only consultant diagnosed context confusion and reviewed the fix, identifying the atomic-provenance retry issue and label precision; both were corrected. Reviewer did not execute these tests. Passive Impeccable Operate/craft and Emil interaction guidance were used; Taste website workflow and unsafe runtimes were skipped.

This addresses the reported conversation/context/scrolling defects and extends current v2 surfaces. It does not restore all legacy editor/terminal/Usage capabilities, establish participant comprehension or broad startup/CPU/long-history/soak acceptance, validate physical Mac/mobile/screen readers, publish signed releases, demonstrate partially failed NSIS rollback, or close the existing exceptional updater-launcher timeout gap.
