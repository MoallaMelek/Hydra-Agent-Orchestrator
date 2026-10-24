<div align="center">

<img src="docs/media/hydra-mark.svg" width="88" alt="Hydra" />

# Hydra

**Many coding agents. One supervisor. Nothing lands without proof and your approval.**

Hydra is a desktop app that runs Claude Code and Codex CLI as a team: one plans, one builds, another reviews. Hydra runs your real tests itself and shows you exactly what happened before anything touches your code.

![Status](https://img.shields.io/badge/status-developer%20preview-f5a524)
![Agents](https://img.shields.io/badge/agents-Claude%20Code%20%C2%B7%20Codex%20CLI-39c6d6)
![Desktop](https://img.shields.io/badge/desktop-Electron-47848f)
![Data](https://img.shields.io/badge/data-local%20SQLite-3a7bd5)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)

<img src="docs/media/replay.gif" alt="Replaying a real Hydra mission: the planner hands its plan to the implementer, runs appear on the mission clock in recorded order, the reviewer picks up the revision, and checks land on each revision" width="100%" />

<sub>A real mission replayed in Hydra: <i>"improve everything, u have full autonomy"</i> on a Python computer-vision project. Planner and reviewer on Claude Code, implementer on Codex CLI. Every mark and pulse comes from a recorded event.</sub>

</div>

---

## The pipeline

**PLAN → IMPLEMENT → REVIEW → FIX → VERIFY → DEMO → APPROVAL**

```mermaid
flowchart LR
    you(["You describe a change"]) --> plan["Plan<br/>planner agent"]
    plan --> impl["Implement<br/>own git worktree"]
    impl --> review["Review<br/>a second agent"]
    review -->|findings| fix["Fix<br/>bounded rounds"]
    fix --> review
    review -->|approved| verify["Verify<br/>Hydra runs your checks"]
    verify --> demo["Demo<br/>before vs after"]
    demo --> decide{"Your decision"}
    decide -->|Accept| apply(["Applied to your branch"])
    decide -->|Request changes| fix
    decide -->|Reject or keep branch| safe(["Your tree untouched"])
```

- **Isolated changes.** Every change runs in its own git worktree on a `hydra/*` branch. Hydra delivers a revision only after your approval. Recorded applies offer revert-based rollback, subject to branch state and conflict resolution. Project checks still run as your user, so use repositories you trust.
- **Evidence, not claims.** Hydra runs your project's tests and builds itself (Node, Python, Go, Rust, Java, C/C++, or your own `.hydra/checks.json`). It records exit codes against the exact commit and shows before and after results. An agent saying "tests pass" is never evidence.
- **Independent review.** A second agent (a different provider when available) reviews the diff together with the real test results. Fix rounds are bounded.
- **Budgets.** Per-task limits on cost, tokens, active time and agent runs.
- **Your accounts, your bill.** Hydra uses *your* locally signed-in Claude Code and Codex CLIs. It never stores, proxies or ships credentials.
- **Your data stays local.** Everything lives in a local SQLite database. Remote control from a phone on your network is end-to-end encrypted, and no cloud database is involved.

## Two real missions

Both ran on the same night in October 2026, from open-ended prompts that handed the agents "full autonomy".

| | **telekinisis** · *"improve it, u have full liberty to act autonomously"* | **Vector** · *"improve everything, u have full autonomy"* |
|---|---|---|
| Team | Planner and reviewer on Claude Code, implementer on Codex CLI | Same team |
| Work | 5 agent runs, 3 revisions, 1 repair round | 7 agent runs, 4 revisions, 2 repair rounds |
| Review | **Approved**: no blocker or major problem | **Changes requested** (3 findings across its reviews) |
| Hydra's own checks | `unittest` **fail → pass**, no regressions | `pytest` **pass → fail**: a regression |
| Outcome | Branch kept | Branch kept, **nothing applied to the project** |
| Reported cost | $0.99 + unpriced Codex usage | $1.45 + unpriced Codex usage |

The second mission is the interesting one. The planner refused to boil the ocean:

> *"Improve everything" is too broad to deliver in one reviewable change, so this plan targets the most valuable gaps I found: robustness and safety in the live runtime path (camera, vision worker, app startup and shutdown).*

The implementer delivered camera recovery, stall handling and resource cleanup. The reviewer found a real problem in the new tests. Hydra's own before/after run showed `pytest` passing on the original commit and failing on the final one. So nothing was merged. The work stayed on its branch, and the evidence for why is one click away.

## Inside the app

Every mission opens on an **evidence map**, drawn only from what Hydra recorded. There is no invented agent chatter, no fake progress bars and no success states nobody observed. Anything derived from a stated rule is marked as derived.

<img src="docs/media/mission-network.png" alt="The Vector mission on Hydra's evidence map: stages around the mission clock, three agents labelled by provider, handoffs, four revisions with their check badges, and the mission briefing" width="100%" />

<sub>**The mission clock.** Stages run clockwise in recorded order. Agents sit outside the clock, each one a role on a provider. Revisions run left to right inside it, each with a badge counting its checks. The briefing on the right is computed from the records: who did what, every handoff, where the work landed and what the proof says.</sub>

<table>
<tr>
<td width="50%"><img src="docs/media/agent-focus.png" alt="The Codex CLI implementer in focus: its three runs, 25 reported tool calls, 9 edits and 3 revisions" /></td>
<td width="50%"><img src="docs/media/revision.png" alt="Revision ef311fa selected: commit, checks on it (two failed pytest runs), who produced it and who reviewed it" /></td>
</tr>
<tr>
<td><b>Focus on an agent.</b> Everything else dims. Its runs, reported tool calls, edits, revisions and token usage come straight from the run records.</td>
<td><b>Follow a revision.</b> The exact commit, the checks Hydra ran on it, the run that produced it and the review that read it.</td>
</tr>
<tr>
<td><img src="docs/media/timeline.png" alt="Timeline lens: you, the agents, edits by file and the checks Hydra ran, in lanes over 16 minutes of recorded time" /></td>
<td><img src="docs/media/records.png" alt="Records lens: the plan written by the planner and the before/after check comparison showing the pytest regression" /></td>
</tr>
<tr>
<td><b>Timeline.</b> The same records in lanes: you, each agent, edits by file and every check Hydra ran, across the mission's 16 recorded minutes.</td>
<td><b>Records.</b> The full plan, the before/after comparison (here: <code>pytest</code> pass → fail, flagged as a regression), every check and the event log.</td>
</tr>
<tr>
<td><img src="docs/media/mission-network-day.png" alt="The same mission in the Day theme" /></td>
<td><img src="docs/media/second-mission.png" alt="The telekinisis mission: plan, build, review, repair, a second review and passing checks" /></td>
</tr>
<tr>
<td><b>Night and Day.</b> Two full themes, designed together. Red always means something stopped.</td>
<td><b>Another mission.</b> The telekinisis run: plan, build, review, one repair round, a second review, then checks that went from failing to passing.</td>
</tr>
</table>

**Replay** (the animation at the top) steps through recorded time. Later records are hidden and outcomes never leak backwards. Each newly recorded handoff or result lights up once, and decisions are disabled until you return to the present. With reduced motion on, it steps from moment to moment without animation.

<sub>Screenshots and animation: the packaged desktop app at 1536×864 (125 % scaling on a 1920×1080 display), on a read-only copy of the owner's own Hydra records. Project names, prompts and agent output are real. The interface shown is the redesign on the [`feat/jarvis-ux-alpha6-20261022`](https://github.com/MoallaMelek/Hydra-Agent-Orchestrator/tree/feat/jarvis-ux-alpha6-20261022) branch, which is not merged into `main` yet.</sub>

## How it is built

```mermaid
flowchart TB
    subgraph desktop["Desktop app (Electron)"]
        ui["React UI<br/>evidence map, replay, decisions"]
    end
    subgraph hydrad["hydrad (local engine)"]
        api["HTTP + WebSocket API<br/>typed, zod-validated"]
        orch["Orchestrator<br/>workflow, stages, budgets, policy"]
        agents["Agent adapters<br/>Claude Code, Codex CLI"]
        iso["Isolation<br/>git worktrees"]
        verify["Verification<br/>check detectors and runner"]
        store[("SQLite journal<br/>tasks, runs, evidence, events")]
    end
    phone["Paired phone<br/>same UI, remote"]
    ui <--> api
    api --> orch
    orch --> agents
    orch --> iso
    orch --> verify
    orch --> store
    phone -.->|"encrypted channel"| api
```

| Package | What it does |
|---|---|
| [`packages/engine`](packages/engine) | The orchestration engine as a library: store, workflow, stages, adapters, isolation, verification, budget, policy. |
| [`packages/protocol`](packages/protocol) | Versioned zod schemas for every domain type, API call and event. |
| [`packages/secure-channel`](packages/secure-channel) | Pairing and session cryptography shared by the engine and the phone client. |
| [`packages/ui`](packages/ui) | The React interface, including the canvas evidence map, replay and the read-only evidence graph adapter. |
| [`apps/hydrad`](apps/hydrad) | Engine host: HTTP/WebSocket API, static UI, remote bridge, CLI (`hydrad serve`, `hydrad doctor`). |
| [`apps/desktop`](apps/desktop) | Electron shell: starts hydrad, opens the window, native dialogs and updates. |

The workflow never branches on "Claude" or "Codex". It asks adapters for capabilities, so providers are interchangeable per role. Every restriction is labelled honestly as enforced by the OS, by the provider CLI, or by a prompt only. More detail: [Architecture](docs/v2/ARCHITECTURE.md) · [Threat model](docs/v2/THREAT_MODEL.md) · [Decisions](docs/v2/DECISIONS.md) · [User guide](docs/v2/USER_GUIDE.md).

## Status

**Supervised developer preview.** Historical real-provider and CI evidence is dated in [TEST_EVIDENCE](docs/v2/TEST_EVIDENCE.md); it does not qualify every current build or platform. Signing, public update feed and recovery, hostile-code containment, trusted remote bootstrap and broader hardware and accessibility qualification remain release gates. Nothing has been published as a release.

## Develop

Requires Node ≥ 22.13 and git, plus Claude Code and/or Codex CLI signed in on your machine.

```bash
npm install
npm run check      # typecheck, lint, tests, originality check
npm run desktop    # build and launch the desktop app
```

## Licence

Copyright © 2026 Melek Moalla. All rights reserved. No licence is granted until a licence file is added.
