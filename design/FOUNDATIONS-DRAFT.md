# Hydra UX rebuild — foundations draft (pre-lock)

Status: DRAFT for direction choice, 22 October 2026. Written for `/hone:design` Phase C → D. Nothing here is locked until a direction is picked; the direction-specific palette and type then become `design/DESIGN-SYSTEM.md` + `design/VOICE.md`, and the alpha.6 `DESIGN.md` is archived under `design/archive/` (REBRAND).

## Product truth

- **Audience:** a developer supervising Claude Code and Codex CLI agents on their own trusted repositories, on a 1366–1920 px laptop (Windows first), in 5–60 minute sessions, often stepping away and returning; occasionally approving from a phone.
- **Job:** "When I hand a change to AI agents, I want to see exactly what they did to my code and whether that exact revision is proven, so I can accept it without re-reading everything, or catch the problem."
- **Register:** precise · alive · accountable.
- **Competitive set:** Cursor agent mode, GitHub Copilot coding agent, Devin, Conductor, Claude Code CLI, LangGraph Studio.
- **Category default to defect from:** transcript column + diff pane, indigo/violet accents, Inter/Geist, rounded cards and pills, a flowchart of rectangles wired by arrows, a spinner that says "thinking".

## Truth grammar (all directions)

Every mark says how it is known. This is the product's credibility, so it is a visual rule, not a footnote.

| Basis | Meaning | Line / outline |
|---|---|---|
| Observed | Recorded by the engine (stage, run, tool report, check, review, diff, receipt) | solid |
| Derived | Computed from records by a stated rule (revision order, who produced a commit, "not raised again") | dashed 6/4 |
| Planned | Intent, not outcome (plan's likely files, acceptance criteria) | dotted 1.5/4 |
| Unavailable | Known to exist, not retained in this data | struck label + explicit sentence |

Never drawn: model thoughts, agent-to-agent messages, progress percentages, parallelism inside one mission (agents take turns), success that was not recorded.

## Entity glyphs (all directions)

Run ● (agent's hue) · File ■ (filled = in the final change, outline = touched, dotted = planned only) · Revision ◆ (filled = proposed head) · Check ⬡ (filled = passed, red ✕ = failed) · Finding ▲ (filled red = blocker, red outline = major, grey = minor/nit) · Your decision ⊕ · Stage = arc segment / band.

## Colour laws (to be bound to one palette at lock)

1. **Hue means who.** Planner, implementer, reviewer, engine, you: one hue each, never reused.
2. **Red means stop.** Failed checks, blocking findings, blocked decisions. Nothing decorative is red; deletions are not red.
3. **Light means now.** Brightness and luminance carry recency and amount; finished work cools to dim ink.
4. **Yellow means your turn.** One highlighter colour, only where Hydra is waiting for you.

## Motion vocabulary (named moves)

| Move | Trigger | Duration / easing | Reduced motion |
|---|---|---|---|
| FORM | A record appears (load, replay, live event) | 240–420 ms, cubic-out, grows from the record that introduced it | appears in place |
| HANDOFF | A stage transition is recorded | ring segment lights in the handing-off hue, 420 ms | static lit segment |
| ISOLATE | Hover, keyboard focus or selection | unrelated marks fade to 12–22 % in 160 ms | instant |
| EGO | Focus (F) on a node | 320–360 ms reflow: inputs left, outputs right | instant reflow |
| BREATHE | A run or check is *actually* running | 1.3 s sine on a halo, only while running | none; the word "Running" |
| REVEAL | Inspector content changes | 160 ms rise 6 px + fade | none |
| STACK | Depth view on/off | 520 ms tilt | instant |

No perpetual animation at rest; nothing loops unless a process is recorded as running.

## Interaction principles

- The map is an instrument: every mark opens its record (diff, output tail, finding, receipt) in one inspector.
- Selection is never stolen by live updates.
- Keyboard first: one tab stop per surface, arrows move spatially or through time, Enter inspects, F focuses, Esc steps back, / searches.
- Every visual has a text equivalent (list view, cross-section list, labelled phases).
- Decisions show the engine's own policy reasons verbatim; the UI never computes its own permission.

## Voice

Plain, exact, unanthropomorphic. "Reviewer reported 3 findings", never "the reviewer thinks". Numbers carry units. Uncertainty is labelled ("derived", "not retained"). Controls say what happens: "Accept revision 25e31e8", then "Applied 25e31e8 to main".

## Banned

Purple/indigo gradient AI look; glassmorphism; neon borders; particles or glow without a data channel; fake HUD reticles; "thinking…" spinners; progress percentages Hydra cannot measure; agents chatting to each other; rectangles-and-arrows as the main picture; red for anything but stop; yellow for anything but your turn; emoji as status.
