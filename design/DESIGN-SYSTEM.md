# Hydra — Design System v3 ("Command Network")

*Source: /hone:design REBRAND, 2026-10-22. Directions explored as working prototypes on recorded engine fixtures (design/prototypes). Owner pick, verbatim: "option A is the main priority, maybe option B isn't that bad, but forget totally about option C". Archived predecessor: design/archive/2026-10-22-b3f7464/DESIGN.md (alpha.6 Mission Control).*

**The rule:** A (Neural command network) owns the product: the mission is a settled map of evidence, and the map is the main surface. B (Engineering observatory) contributes exactly one lens, Timeline: linear recorded time with revision gates and the cross-section. Nothing from C. Light means now, hue means who, red means stop; no other colour carries meaning.

## Tokens (CSS custom properties, packages/ui/src/design/tokens.css)

Night (default): `--void #07090c` canvas ground, never a panel · `--deck #0d1117` panels, inspector, command frame · `--deck-2 #121821` raised controls, inputs · `--rule #18202a` hairlines · `--rule-2 #26303c` control borders · `--ink #e8ecf1` primary text, revision fill · `--ink-2 #9ba6b4` secondary text · `--ink-3 #7b8696` tertiary text (≥4.8:1 on every surface).
Agents (hue = who, never reused): `--planner #74b9ff` · `--builder #ffb24a` (implementer, repair) · `--reviewer #3fd0c4` · `--engine #a9b6c6` (checks, Hydra itself) · `--you #f4efe3` (your request, decisions, revisions you own).
`--stop #ff5b52`: failed checks, blocker/major findings, blocked decisions, errors. Nothing else. Deletions are ink-3, not red.
Day (token swap, not component swap; `[data-theme=light]`): void `#f4f6f8` · deck `#ffffff` · deck-2 `#eef1f4` · rule `#dde2e8` · rule-2 `#c8cfd8` · ink `#0e1217` · ink-2 `#48525f` · ink-3 `#59626e` · planner `#1d63b0` · builder `#9a5800` · reviewer `#0b7a71` · engine `#566373` · you `#0e1217` · stop `#c62a24`. All ≥4.5:1 on day surfaces. Saved `terracotta` preferences render Night.

## Type

Archivo (variable, wght 100–900, wdth 62–125, OFL, self-hosted) = all UI and display. Display: 650–750 at wdth 88–94, −0.01em. Labels on the map: 500–650 at wdth 87 (semi-condensed). Body 14–15px/1.5 at wdth 100. Azeret Mono (OFL) = every hash, path, command, duration, count and time offset; tabular; never running prose. Scale: 11 · 12 · 13 · 14 · 16 · 19 · 22 · 28 · 36.

## The network (signature component, Canvas 2D + DOM)

Mission lens = an elliptical clock (rx:ry = 1.6:1). Stage attempts sit on the ring clockwise from twelve in recorded order; the ring segment between consecutive stages lights in the hue of the stage that handed off (HANDOFF). Runs sit inside their stage (0.84 rx). Revisions form the spine across the centre in recorded order (base → head); checks fan over the top of the revision they ran on; files settle in the inner field, pulled by edits (strong) and reads (weak); findings stack left of their file; your decision sits right of the head.
Glyphs: run ● hue-filled, radius 5 + √activity × 1.3 (max 22) · file ■ (filled ink = in final change, outline = touched, dotted = planned only) with a 2px +/− bar · revision ◆ (filled = head/applied) · check ⬡ (engine fill = passed, stop + ✕ = failed, outline = running) · finding ▲ (stop fill = blocker, stop outline = major, engine/ink-3 outline = minor/nit) · decision ⊕ (stop ring = blocked). Basis: observed solid · derived dash 6/4 · planned dot 1.5/4 · unavailable = no mark + sentence in the inspector.
Edges: hue of the source actor, additive light on Night (multiply on Day), α 0.20 at rest, 0.85 when lit, 0.04 when dimmed. Labels: Azeret for paths/hashes, Archivo for stages; greedy placement right → left → below → above, never over a glyph.
Project lens = mission cores on a ring, linked only through files they recorded touching. Lists replace the canvas below 600px.

## Inspector · command frame · controls

Inspector: right column 380px (stacks below the map under 960px), `--deck`, 18/20px padding, one record at a time: eyebrow (kind · actor), title, status + basis + offset tags (11px mono, 1px rule-2 border, radius 3), facts grid, evidence (diff/output, mono 11.5px on `--void`, max 300px scroll), connections as links. Command frame: 52px top bar, `--deck`, hairline below; brand, workspace switcher, global find (/), accounts, phone, settings. Buttons: radius 4, 1px rule-2, 6/11px padding, 32px min height; primary = ink fill with void text; destructive = stop text on transparent. Channel chips (legend = filter): pill, 1px rule-2, glyph + label + mono count; off = 38% + strike.

## Material rules

1. Light is the only effect: brightness for activity and recency, dimming for focus. No glow without a data channel.
2. Surfaces are flat: no gradients, no glass, no inner shadows, no textures.
3. One shadow, floating only (menus, sheets): `0 16px 40px rgba(0,0,0,.5)` Night / `rgba(14,18,23,.16)` Day.
4. Radius budget: 4 controls, 3 tags, 999 chips, 0 panels that touch an edge. Nothing rotated.
5. No pure #000/#fff. No emoji. No icons without text in the map's legend.
6. Status is never colour alone: every state also has a word or a glyph shape.

## Motion (named moves; all ≤ 420 ms; reduced motion = instant, no loops)

FORM (record appears): grows from the record that introduced it, 240–420 ms cubic-out. HANDOFF: ring segment lights, 420 ms. ISOLATE: unrelated marks to 12% in 160 ms on hover, focus or selection. EGO (F): 360 ms reflow, inputs left, outputs right; Esc reverses. BREATHE: 1.3 s sine halo only while a run or check is recorded as running. REVEAL: inspector 160 ms rise 6px + fade. Nothing animates at rest.

## Copy rules

Functional labels on controls ("Accept 25e31e8", "Request changes", "Focus", "Replay"); voice lives in empty states, refusals and receipts. Never anthropomorphic, never "thinking". Full voice: design/VOICE.md.

## Screen inventory (13)

Home · project network★ (`dashboards`,`navigation-shell`,`states`) · Mission composer★ (`forms`,`microcopy`) · Live mission network★ (`dashboards`,`motion`,`states`) · Timeline lens (`dashboards`,`motion`) · Evidence inspector (`microcopy`,`states`) · Delivery decision★ (`user-flows`,`microcopy`) · Mission replay (`motion`,`states`) · Conversation / answer (`microcopy`) · Project & history (`dashboards`,`states`) · AI accounts (`settings-account`,`states`) · Settings (`settings-account`,`forms`) · Phone access & pairing (`settings-account`,`user-flows`,`mobile-patterns`) · First run / no projects (`onboarding`,`states`).
(★ = funnel-critical: Home, Composer, Live mission, Delivery.)
