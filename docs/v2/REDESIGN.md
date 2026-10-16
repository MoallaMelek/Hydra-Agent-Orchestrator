# Hydra interface redesign: "Relay"

Branch `redesign/live-operations`. This record covers what Hydra really does (the baseline), the directions compared, the one chosen, the design system, the event model and the performance budget. Evidence is in TEST_EVIDENCE.md.

## 1. What the interface has to show (from the code, not assumed)

- **One task is strictly sequential.** `workflow/machine.ts`: plan → implement → review ⇄ fix → verify (→ fix) → demo → final approval → apply. The review stage first runs Hydra's own checks (`pre_review`), then the reviewer. Inside a task, no two agents ever run at the same time.
- **Concurrency is across tasks.** Agent processes share one engine-wide semaphore (`agentSlots`, 3 by default). A task whose stage needs an agent waits for a free slot. This is the only real parallelism, so it is what the interface shows as parallel.
- **Human gates.** Plan approval (Safe mode, and every high-risk request whatever the mode), and final approval in every mode. Apply is serialized per repository (`KeyedMutex`).
- **What is observable.** Durable: `task.updated` (stage records with times and attempts, plan, review, route, assignment, waits, usage), `run.updated` (each agent run: role, provider, model, times, usage, error), `evidence.recorded` (each check Hydra ran: command, exit code, commit, duration), `task.log`. Live only: `run.output` (agent text, streamed answers).
- **What was missing, and was added** (small, engine-authoritative, no change to decisions):
  - `run.activity` (live) and `AgentRunInfo.activity` (kept on the run): each tool call the provider CLI reports, as tool name, kind (read / search / edit / command) and target (path, pattern or command, redacted, 300 chars). Never file contents, never model reasoning.
  - `Task.selection`: at creation the engine compares the chosen agents with its own recommendation and records "suggested" or "yours", with the recommendation's stated reason.
  - Snapshot `activeRuns` and `agentSlots`: which agent processes run right now, across tasks, and the limit.
  - Claude Code `Bash` calls now report their command (they reported nothing).
- **Inferred, and labelled as such.** "Waiting for a free agent slot" (a stage that needs an agent has started, no run yet, all slots busy). Handoffs (one role's run ends, the next role's begins). Progress is never estimated as a percentage: stages are discrete, and the interface shows them as such.
- **Not available, and said so.** Tool activity for runs recorded before this change (only the last 8 KB of text). Live output is not stored: after a restart the run's activity list remains, its streamed text does not.

## 2. Baseline (old interface), measured

Hardware: Dell Vostro 15 3530, Intel Core i7-1355U (10 cores / 12 threads, 15 W), Intel Iris Xe (integrated), 24 GB RAM, Samsung NVMe SSD, 1920×1080 at 120 Hz with 125 % scaling, Windows 11. Frame budget at 120 Hz: 8.3 ms.

| Measure (real app or Electron renderer) | Old interface |
|---|---|
| UI bundle | 494 KB JS (155 KB gzip), 21.6 KB CSS |
| Launch → interface rendered (real app, 3 runs) | 2.2–3.6 s; first paint 0.40–0.62 s after navigation |
| Idle, nothing running (real app) | ~1 % of one core in total; ~440 MB working set, ~240 MB private, 5 processes |
| Three agents running, no new events (lab, Electron) | **GPU process 26 %, renderer 9 % of one core**: infinite pulse animations |
| One real question to Claude, Home on screen | GPU 19.5 %, renderer 9 %, engine 4.8 % of one core over 10.6 s |
| 4,068 events in 2.3 s (lab "flood", Electron, 5 runs) | 0 long tasks, max frame 33 ms (median), but the default task view shows no agent output at all |

Bottlenecks found before adding anything:
1. Infinite CSS animations (`hx-pulse` on every "running" badge and stage node, with an animated box-shadow) repaint continuously while anything runs, whatever is on screen.
2. The store re-renders the whole application on every event, including each streamed output chunk.
3. The task view refetches the whole task detail over HTTP on every run or evidence event.
4. Nothing shows agent activity unless the Agents tab is opened; concurrency and the repair loop are invisible.

## 3. Directions compared

| | A. Operations floor | B. Signal trace | C. Artifact chain |
|---|---|---|---|
| Idea | Stations (planner desk, implementer bench, review desk, verification bay, your desk); the change moves between them | One lane per actor over time; observed work as segments; a live edge | The chain Request → Plan → Commit → Review → Evidence → Decision, each produced by an agent |
| Originality | High, but close to a game costume | Medium (Gantt-like) unless given a real idea | Medium |
| Clarity for an engineer | Weak on time, repeats, history | Strong: order, duration, overlap, loops | Strong on outputs, weak on time and concurrency |
| Clarity for an observer | Strong | Medium | Medium |
| Density / scale | Poor beyond a few tasks | Good: same component at overview and detail size | Good |
| Replay, timeline | Hard | Natural (time is the axis) | Partial |
| Cost to render | Moving cards: layout and paint | Static shapes plus one edge updated once a second | Static |
| Accessibility | Spatial-only meaning | Lanes map to a list and a table | List |

**Chosen: B, carried by C's artifacts, named "Relay".** One coherent move: lanes are the agents (and you, and Hydra's own checks), segments are the work they really did, and each artifact is a baton handed from one lane to the next, converging on your decision. Its source is the Hydra mark itself (three heads converging into one verified result). A was rejected because it hides time, repeats and history, the things that explain a repair cycle; C alone cannot show concurrency.

## 4. Design system

- **Mode:** an Operate surface. Standard controls (buttons, tabs, selects, tables, dialogs); the world contributes type, palette, density and one signature move, the Relay trace.
- **Type:** the system UI face (Segoe UI Variable on Windows, SF on macOS): no web font to download, no layout shift. Scale 12 / 13 / 14 / 16 / 20 / 26. Tabular numerals for times, money, counts. Monospace only for paths, commands, SHAs and logs.
- **Palette:** graphite ground in three tone steps (surfaces separated by tone, not by lines and shadows); one accent (signal blue) for live work and primary actions; state colours only where they mean something: amber = needs you, green = verified or passed, red = failed or blocked. Agents are not colour-coded (colour stays for state); lanes carry role and provider names. Light theme mirrors it.
- **Density:** 4 px grid; lanes 34 px; panels 12 px radius, controls 8 px.
- **Motion vocabulary** (CSS transitions only; transform and opacity; 120–220 ms; strong ease-out `cubic-bezier(.23,1,.32,1)`):
  - *activate*: a new segment grows from its start (scaleX, 180 ms), once;
  - *hand off*: a new artifact baton fades and slides 6 px into place (180 ms), once;
  - *needs you*: the decision bar appears once (opacity + 8 px), then holds still; amber colour carries the state, never a pulse;
  - *fail / recover*: colour change (150 ms), no shaking;
  - *focus change*: inspector content crossfade (150 ms).
  - Live time advances in discrete one-second steps with no animation in between. **No infinite animation anywhere.**
  - Reduced motion: opacity-only versions, no movement.
- **Adaptive quality:** Full / Reduced / Minimal (Settings; Auto by default). Auto picks Reduced with `prefers-reduced-motion` and Minimal when the page detects sustained long frames. Lower levels drop transitions and per-tool ticks (counts remain); no information is lost.

## 5. Performance budget (hard rule: not noticeably slower)

| Measure | Budget |
|---|---|
| Running tasks, no events | GPU + renderer below 1 % of one core (old: 35 %) |
| Flood (≈4,000 events) | No long task; max frame ≤ old + 25 %; drains as fast as old |
| Launch → rendered | ≤ old + 10 % |
| UI bundle gzip | ≤ old + 15 % |
| Memory | Bounded per run (200 tool calls, 60 KB text), per task (300 log lines), runs kept 500 |
| Engine | The interface never waits on, slows or gates the engine; all instrumentation is fire-and-forget publish |

Data flow: events go into the store immediately, subscribers are notified at most once per animation frame, components subscribe to slices, the task detail is fetched once and then kept current from events.

## 6. Results (measured 2026-10-16, same hardware and harnesses as §2)

| Measure | Before | After |
|---|---|---|
| UI bundle (gzip) | 155.0 KB JS, 5.2 KB CSS | 166.7 KB JS (+7.5 %), 7.9 KB CSS |
| Launch → interface rendered, real app (3 runs each) | 2.2–3.6 s | 1.1–1.4 s (file-cache variance likely contributes) |
| First paint | 0.40–0.62 s | 0.25–0.28 s |
| Idle, real app | ~1 % of one core; ~440 MB working set, ~240 MB private | 0.3–2 %; ~450 MB, ~255 MB |
| Three agents running, no events (lab, Electron) | GPU 26 %, renderer 9 % | GPU 0.3–0.6 %, renderer 0.4–0.6 % (one noisy run in five) |
| One real question, start screen on display | renderer 9.0 %, GPU 19.5 % | renderer 1.3–1.4 %, GPU 0 % |
| Flood, 4,068 events (5 runs, median) | 2,263 ms, worst frame 33 ms, 0 long tasks | 2,187 ms, worst frame 17 ms, 0 long tasks |
| Stress, 13,518 events (3 runs) | 4.6–4.7 s, average frame 8.3 ms, worst 9–16 ms, 0 long tasks | 4.8 s, average 8.4 ms, worst 17–25 ms, 0 long tasks |

Trade-off, stated: under the stress load (about a hundred times what real agents produce) the worst frame is one to two 120 Hz frames longer than the old screen, which showed no live data at all. The first version of the inspector produced a 63 ms long task there (re-laying out 60 KB of output every frame); it now shows the latest 4 KB and the long task is gone.

**Real agents, real app** (`tools/relay-real.mjs`): two changes started together in two repositories, Claude Code planning and reviewing, Codex implementing. Both reached final approval in 67 s; their agents overlapped for 51 s (real concurrency, shown on the command center as 2 of 3 slots in use). Tool calls, stage notes, commits, checks and the before/after comparison in the trace are the engine's own records. Cost $0.14 and $0.10 plus Codex tokens.

**Fixtures** (labelled "SIMULATED FIXTURE" on screen, never in the shipped bundle, checked by grep of the production build): simple question, full change, concurrent tasks with a slot wait, failed review with two repair rounds, plan approval, high-volume events.

**Independent review** (Codex CLI, fresh read-only session): 10 findings (2 High: credentials in command targets, snapshot rollback; 7 Medium: unbounded caches, a finished tool call shown as current activity, "no checks" shown as "passed", a check log under the wrong check, an earlier demo showing the latest round, inference labels missing on the command center, eviction vs "loaded"; 1 Low: benchmark labelling). All fixed, with tests (the credential test fails on the old code).

**Not verified in this round:** the desktop end-to-end script with the new labels (`tools/desktop-e2e.mjs`, updated) was not re-run, at the owner's request not to open more windows; a real failed review and a real plan approval were seen only in fixtures and engine tests; a physical phone; screen readers.

## 7. Skills used

- **Impeccable** (read as reference; its launcher was not run because it downloads a native binary): Operate-mode rules (standard controls, motion only for state, 150–250 ms, the world contributes type, palette, density and one signature move), the craft floor (contrast, states, no eyebrow labels, no decorative glass or gradients). Influenced the restraint of the shell and the single signature move.
- **Emil Kowalski** (`emil-design-eng`, `animation-performance`): the animation decision framework (animate only what changes state; nothing on things seen hundreds of times a day), transform/opacity only, CSS instead of state-driven animation loops, `prefers-reduced-motion`. Directly produced the "no infinite animation" rule that removed the 26 % GPU cost.
- **Taste Skill** (`design-taste-frontend`, step 4 only, "find the idea"): the signature move comes from Hydra's own mark (three heads converging into one verified result → lanes converging on your decision). Its page-composition scripts and marketing-page rules were not used: they target persuasion pages, and some (no hairlines, no monospace) conflict with an operations tool, where tables and paths need them; Impeccable's Operate rules won.
- **vercel-react-best-practices**: re-render rules (subscribe to derived slices, avoid state in hot paths) shaped the store and selectors.
- Not used: `redesign-existing-projects` (advises noise textures and stock photography: wrong for this surface), the experimental Taste variants, image generation.
