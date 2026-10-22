# COVERAGE — /hone:audit (scoped: Command Network rebuild)

SHA: f3406a6 · target: packages/ui review harness (`review.html`, recorded real-engine fixtures, read-only) + real Electron app (first-run cell, empty isolated profile) · driver: Playwright (Chromium headless, CDP for Electron) · date: 2026-10-22
Viewports: 1440×900 and 390×844. Themes: Night everywhere; Day on funnel-critical Home + Mission. Reduced motion: renderer and CSS make every move instant (code-verified; no separate motion cell — see waivers).
Scope: all 13 inventory screens of design/DESIGN-SYSTEM.md. Stress cells: long title on Home rows and Mission header.

| Screen | State | Viewport | Shot | Axe | How to reach |
|---|---|---|---|---|---|
| accounts | default | 1440 | [x] `accounts--default--1440.png` | axe ✓ | ?view=providers |
| accounts | default | 390 | [x] `accounts--default--390.png` | axe ✓ | ?view=providers |
| conversation | answered | 1440 | [x] `conversation--answered--1440.png` | axe ✓ | ?mission=question |
| conversation | answered | 390 | [x] `conversation--answered--390.png` + `--full` | axe ✓ | ?mission=question |
| delivery | request-changes-dialog | 1440 | [x] `delivery--request-changes-dialog--1440.png` | axe ✓ | mission repair → Request changes |
| delivery | request-changes-dialog | 390 | [x] `delivery--request-changes-dialog--390.png` + `--full` | axe ✓ | mission repair → Request changes |
| first-run | default | 1440 | [x] `first-run--default--1440.png` | axe ✓ | real Electron, empty HYDRA_DATA_DIR profile |
| first-run | default | 390 | [x] `first-run--default--390.png` + `--full` | axe ✓ | real Electron, empty HYDRA_DATA_DIR profile |
| home | composer-open | 1440 | [x] `home--composer-open--1440.png` + `--full` | axe ✓ | review.html (recorded fixtures) → Home |
| home | composer-open | 390 | [x] `home--composer-open--390.png` + `--full` | axe ✓ | review.html (recorded fixtures) → Home |
| home | default | 1440 | [x] `home--default--1440.png` | axe ✓ | review.html (recorded fixtures) → Home |
| home | default | 390 | [x] `home--default--390.png` + `--full` | axe ✓ | review.html (recorded fixtures) → Home |
| home | default-day | 1440 | [x] `home--default-day--1440.png` | axe ✓ | review.html (recorded fixtures) → Home |
| home | find-open | 1440 | [x] `home--find-open--1440.png` | axe ✓ | review.html (recorded fixtures) → Home |
| home | stress-title | 1440 | [x] `home--stress-title--1440.png` | axe ✓ | review.html (recorded fixtures) → Home |
| home | stress-title | 390 | [x] `home--stress-title--390.png` + `--full` | axe ✓ | review.html (recorded fixtures) → Home |
| inspector | check-failed | 1440 | [x] `inspector--check-failed--1440.png` | axe ✓ | mission → List chip → item → List chip |
| inspector | check-failed-mobile | 390 | [x] `inspector--check-failed-mobile--390.png` + `--full` | axe ✓ | mission → List chip → item → List chip |
| inspector | decision-blocked | 1440 | [x] `inspector--decision-blocked--1440.png` | axe ✓ | mission → List chip → item → List chip |
| inspector | file-diff | 1440 | [x] `inspector--file-diff--1440.png` | axe ✓ | mission → List chip → item → List chip |
| inspector | finding | 1440 | [x] `inspector--finding--1440.png` | axe ✓ | mission → List chip → item → List chip |
| inspector | run | 1440 | [x] `inspector--run--1440.png` | axe ✓ | mission → List chip → item → List chip |
| mission | applied | 1440 | [x] `mission--applied--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | blocked | 1440 | [x] `mission--blocked--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | blocked | 390 | [x] `mission--blocked--390.png` + `--full` | axe ✓ | review.html?mission=<scenario> |
| mission | failed | 1440 | [x] `mission--failed--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | failed | 390 | [x] `mission--failed--390.png` + `--full` | axe ✓ | review.html?mission=<scenario> |
| mission | failures-lit | 1440 | [x] `mission--failures-lit--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | focus | 1440 | [x] `mission--focus--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | list-view | 1440 | [x] `mission--list-view--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | plan-gate | 1440 | [x] `mission--plan-gate--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | plan-gate | 390 | [x] `mission--plan-gate--390.png` + `--full` | axe ✓ | review.html?mission=<scenario> |
| mission | replay-mid | 1440 | [x] `mission--replay-mid--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | search-open | 1440 | [x] `mission--search-open--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | stress-title | 1440 | [x] `mission--stress-title--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | stress-title | 390 | [x] `mission--stress-title--390.png` + `--full` | axe ✓ | review.html?mission=<scenario> |
| mission | waiting-accept | 1440 | [x] `mission--waiting-accept--1440.png` | axe ✓ | review.html?mission=<scenario> |
| mission | waiting-accept | 390 | [x] `mission--waiting-accept--390.png` + `--full` | axe ✓ | review.html?mission=<scenario> |
| mission | waiting-accept-day | 1440 | [x] `mission--waiting-accept-day--1440.png` | axe ✓ | review.html?mission=<scenario> |
| phone | default | 1440 | [x] `phone--default--1440.png` + `--full` | axe ✓ | ?view=devices |
| phone | default | 390 | [x] `phone--default--390.png` + `--full` | axe ✓ | ?view=devices |
| project | history | 1440 | [x] `project--history--1440.png` + `--full` | axe ✓ | ?view=project |
| project | history | 390 | [x] `project--history--390.png` + `--full` | axe ✓ | ?view=project |
| records | changes | 1440 | [x] `records--changes--1440.png` + `--full` | axe ✓ | mission → Records tab (+ sub-tab) |
| records | checks | 1440 | [x] `records--checks--1440.png` + `--full` | axe ✓ | mission → Records tab (+ sub-tab) |
| records | log | 1440 | [x] `records--log--1440.png` | axe ✓ | mission → Records tab (+ sub-tab) |
| records | summary | 1440 | [x] `records--summary--1440.png` + `--full` | axe ✓ | mission → Records tab (+ sub-tab) |
| records | summary | 390 | [x] `records--summary--390.png` + `--full` | axe ✓ | mission → Records tab (+ sub-tab) |
| settings | default | 1440 | [x] `settings--default--1440.png` + `--full` | axe ✓ | ?view=settings |
| settings | default | 390 | [x] `settings--default--390.png` + `--full` | axe ✓ | ?view=settings |
| shell | focus-visible-button | 1440 | [x] `shell--focus-visible-button--1440.png` | axe ✓ | frame interactions |
| shell | hover-chip | 1440 | [x] `shell--hover-chip--1440.png` | axe ✓ | frame interactions |
| shell | mobile-menu-open | 390 | [x] `shell--mobile-menu-open--390.png` + `--full` | axe ✓ | frame interactions |
| shell | project-switcher-open | 1440 | [x] `shell--project-switcher-open--1440.png` | axe ✓ | frame interactions |
| timeline | blocked | 1440 | [x] `timeline--blocked--1440.png` | axe ✓ | mission → Timeline tab |
| timeline | repair | 1440 | [x] `timeline--repair--1440.png` | axe ✓ | mission → Timeline tab |
| timeline | repair | 390 | [x] `timeline--repair--390.png` + `--full` | axe ✓ | mission → Timeline tab |

## Waivers
- Loading/empty for mission map while engine data loads: WAIVED — the harness answers instantly; the loading line (`MissionView.tsx` "Loading recorded runs and checks…") was seen in the Electron run only, not captured.
- Live running mission (BREATHE): WAIVED as live — no provider may run in this audit (Codex out of quota, paid Claude runs forbidden). Covered by `mission--replay-mid` (projectAt shows the review stage as running with its halo).
- Reduced-motion burst: WAIVED — renderer `reducedMotion` sets every duration to 0 and BREATHE off; nothing to burst.
- Phone pairing QR and paired-device states: WAIVED — would turn on phone access (system mutation); copy reviewed on `phone--default`.

## Entities created
None. The harness refuses every command; the Electron profile was a copy under /home/claude/ux/eprof and an empty /home/claude/ux/eprof-empty (left behind: both, disposable, outside the repo).

## Progress log
- Capture complete: every cell ticked with a file or waived. Judging done in one pass.
