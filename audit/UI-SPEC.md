# UI-SPEC — /hone:audit of the Command Network rebuild

SHA f3406a6 · 2026-10-22 · scope: all 13 inventory screens (design/DESIGN-SYSTEM.md) at 1440×900 and 390×844, Night + Day on funnel-critical screens · evidence: `audit/shots/`, `audit/axe/`, `audit/COVERAGE.md`.
Authority order: design/DESIGN-SYSTEM.md + design/VOICE.md → archetype playbooks (dashboards, navigation-shell, states, microcopy, mobile-patterns, user-flows, settings-account) → hone rubric → judge's taste.

## Verdict

**POLISH.** Desktop is coherent and on-system: the mission clock reads as one instrument, hue = who and red = stop hold on every screen, the delivery decision is the most prominent control on every waiting mission, and axe is clean on every Night screen. Two defects break the phone experience (list mode never hides the canvas; a negative-radius canvas error) and one ARIA pattern fails axe on both search surfaces. Everything else is craft.

## Top 5 by impact

1. **F-01** List mode keeps the canvas: on phones the default list is squeezed beside or below an unreadable map.
2. **F-02** `fit()` produces a negative scale on short canvases → `ellipse` throws; mission map blank on 390-wide screens.
3. **F-03** Search results nest a button inside `role="option"` (axe nested-interactive, serious) in global find and map find.
4. **F-04** Day theme tertiary text fails 4.5:1 on tinted rows (axe color-contrast, serious).
5. **F-06** Project-lens mission labels are clipped by the canvas edge.

## Findings

### F-01 · P1 · List view never hides the canvas
Shots: `home--default--390.png`, `mission--plan-gate--390.png`, `shell--mobile-menu-open--390.png` (list column squeezed at right, canvas still drawn).
Authority: DESIGN-SYSTEM "Lists replace the canvas below 600px"; mobile-patterns; rubric §7.
Cause: `.net__canvas { display: block }` (packages/ui/src/app/command.css:202) overrides the `hidden` attribute set in packages/ui/src/ops/intel/IntelNetwork.tsx (canvas `hidden={listMode}`).
Fix: add `.net__canvas[hidden] { display: none; }` after line 202.
Accept: at 390×844 on `?mission=repair`, `getComputedStyle(document.querySelector('.net__canvas')).display === 'none'` and `.net__list` width ≥ 340px.

### F-02 · P1 · Negative scale on a short canvas
Evidence: console errors in `audit-capture-log` for `mission--failed--390` and `delivery--request-changes-dialog--390`: "The major-axis radius provided (-18.63) is negative."
Cause: packages/ui/src/ops/intel/renderer.ts:123 `k = min((w-24)/…, (h-24)/…)` goes negative when the canvas is under 24px tall (laid out but collapsed).
Fix: return early from `fit()` when `rect.width < 48 || rect.height < 48`, and clamp `k` to ≥ 0.05; skip `draw()` when either side < 2px.
Accept: no `ellipse` errors in the console across all 390 cells.

### F-03 · P1 · Interactive control nested in an option
Evidence: `axe/home--find-open.json`, `axe/mission--search-open.json` (nested-interactive, serious, 3 and 7 nodes).
Cause: packages/ui/src/app/Shell.tsx:71 and packages/ui/src/ops/intel/IntelNetwork.tsx:159 render `ul[role=listbox] > li[role=option] > button`.
Fix: drop `role="listbox"`/`role="option"`; render `ul` of `li > button` with `aria-label="Matches"` on the list; keep Enter-selects-first.
Accept: axe nested-interactive count = 0 on both cells.

### F-04 · P2 · Day tertiary text below 4.5:1 on tints
Evidence: `axe/home--default-day.json` (3 × `.mrow--you small`), `axe/mission--waiting-accept-day.json` (`small`, `code` in the delivery bar).
Authority: DESIGN-SYSTEM "All ≥4.5:1 on day surfaces"; visual-foundations.
Cause: Day `--ink-3: #626c78` (packages/ui/src/design/tokens.css:38) on `--you-tint` composites.
Fix: Day `--ink-3: #59626e`.
Accept: axe color-contrast = 0 on both Day cells.

### F-05 · P2 · Invalid definition list in Settings → Updates
Evidence: `axe/settings--default.json` (definition-list, serious).
Cause: `<dd role="status">` in packages/ui/src/views/DesktopUpdatesPanel.tsx:31 (a role on `dd` breaks the dl content model).
Fix: `<dd><span role="status">{status}</span></dd>`.
Accept: axe definition-list = 0 on `settings--default`.

### F-06 · P2 · Project-lens labels clipped
Shots: `home--default--1440.png` ("Quantity-aware pricing with" cut at the right edge), `home--default--390.png`.
Cause: packages/ui/src/ops/intel/renderer.ts:119 pads the project lens by 60px; mission labels run to 46 characters (~260px).
Fix: project-lens horizontal padding 220px (mission lens keeps 210).
Accept: every mission label's measured right edge ≤ canvas width − 8px on `home--default--1440`.

### F-07 · P2 · "Your decision" with no qualifier on missions that never reached it
Shot: `mission--failed--1440.png` (Build failed; the decision glyph reads "Your decision").
Authority: VOICE "accountable: say what is not known"; states playbook.
Cause: packages/ui/src/ops/intel/renderer.ts:44 only qualifies `blocked`.
Fix: append " · not reached" when status is `idle`, " · waiting" when `waiting`.
Accept: the failed mission's decision label reads "Your decision · not reached".

### F-08 · P2 · Waiting rows truncate titles to ~22 characters
Shot: `home--default--1440.png` ("Change pricing for every inv…").
Cause: single-line ellipsis on `.mrow__main b` (packages/ui/src/app/command.css:105) in a 360px column.
Fix: two-line clamp on the title (`display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; white-space:normal`), keep the meta line single.
Accept: on `home--default--1440` every waiting title is fully visible for titles ≤ 60 characters.

### F-09 · P2 · Resting composer clips its placeholder on phones
Shot: `home--default--390.png` (second placeholder line cut at the textarea edge).
Cause: fixed 46px height at packages/ui/src/app/command.css:123.
Fix: at ≤760px the resting height is 64px.
Accept: placeholder fully visible at 390×844.

### F-10 · P3 · Blocked delivery bar costs ~170px of map height
Shot: `mission--blocked--1440.png`, `inspector--check-failed--1440.png`.
Cause: reason, policy disclosure and a warning line stack vertically (packages/ui/src/views/task/DecisionBar.tsx:48-52).
Fix (later): put the policy disclosure inline after the first reason; merge the warnings line into it.
Accept: blocked delivery bar ≤ 120px tall at 1440.

## Cross-screen systems
- Type: Archivo + Azeret Mono only; sizes on the 11–36 scale. Pass.
- Colour: ≤ 6 hues per screen; red only for stop states (failed checks, blocker findings, blocked decisions, Reject). Pass.
- Radius/borders: 4 controls, 3 tags, 999 chips, hairline rule everywhere. Pass.
- Focus: visible 2px ink ring on buttons (`shell--focus-visible-button--1440`) and a dashed key ring on the map. Pass.
- Navigation: frame present on every screen; breadcrumbs on mission; Esc/Back paths exist. Pass.

## Journeys
- First run → value: first-run checklist states the three prerequisites; "Add a project" is the single primary. Pass.
- Waiting decision: Home "Waiting for you" → mission → delivery visible without scrolling at 1440 (both allowed and blocked). Pass. On 390 the delivery bar sits above the fold; the map follows. Pass after F-01.
- Investigate a failure: Failures chip lights the failing check and the blocked decision; the inspector shows exit code and the output tail. Pass.

## Gripes
No GRIPES.md on file; none seeded.

## Appendix
- Out of scope, noted once: the harness serves recorded fixtures, so live BREATHE and loading states were judged from replay and code (see COVERAGE waivers).

## Fix run (same session, after the report-only sweep)
F-01 to F-09 fixed in the commit after f3406a6; F-10 (P3) left open. Re-audit of the touched cells (`audit/verify/`): axe violations 0 across home (Night, Day, find), mission (Day, search, failed, plan gate), settings and the request-changes dialog; no console errors at 390 or 1440; the canvas is hidden in list mode; project-lens labels stay inside the canvas (labels now refuse slots outside the canvas bounds); the failed mission's decision reads "Your decision · not reached".
Still open (P3): a file label can be dropped when every slot collides (`home--default--1440`: `src/pricing.js` square unlabelled; the List view and search still name it).
