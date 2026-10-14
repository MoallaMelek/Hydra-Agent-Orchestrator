# Hydra Grand Prix — architecture (design only; not built)

Grand Prix is an optional way to compare AI coding agents on **your** work, shown through a racing metaphor: each agent setup is a car, the pipeline stages are track sectors, and the finish line is a **verified** result. It must never destabilise normal use: it is a separate mode that reuses the existing engine, isolation and verification.

## 1. Two modes

| | Scout | Grand Prix |
|---|---|---|
| What it does | Recommends a setup for a task from evidence you already have | Runs several setups on the same task, side by side, and compares verified results |
| Runs agents? | **No** (instant, free) | Yes, one full pipeline per entrant |
| Uses your quota? | No | Yes: roughly N times one task. **Requires explicit approval** showing the entrants and an estimate |
| Basis | Local outcome history (`outcomes` table, see `packages/engine/src/intelligence/outcomes.ts`) plus stated rules | Live results of this race, which are then added to the history |
| Output | "Suggested: Claude plans · Codex codes · Claude reviews — in your last 7 similar tasks it succeeded 6 times (median 4 min)", or "rule, not enough history yet" | A result table and the winning change offered for your normal approval |

Scout is already partly implemented: the composer's agent suggestion is Scout's core. Grand Prix builds on it.

## 2. Fair comparison method
Every entrant must get exactly the same chance:
1. **Same starting point:** one base commit, recorded before the race; each entrant gets its own worktree from it.
2. **Same instructions:** the identical task text and plan template; no entrant sees another's work.
3. **Same judge:** the check definitions are captured once at race start (digest-bound, as in Safe mode) and run by Hydra, not by the agents, on each entrant's final commit, in throwaway copies.
4. **Same limits:** identical cost, token, time and fix-round budgets. Codex reports tokens but not prices, so cost comparisons use tokens where prices are missing and say so.
5. **Blind review:** the reviewer of each result is told neither which agent wrote it nor how others did; where possible the reviewer is a provider that is not an entrant, or every entrant is reviewed by the same reviewer.
6. **Order effects removed:** entrants start at the same time (bounded by agent slots) or in randomised order; provider rate limits are recorded, and a run that hit one is marked as such rather than counted as a loss.
7. **Repeatability:** models are not deterministic. One race is one observation. Results are labelled "1 race", and Scout only uses accumulated races (minimum 5 similar observations per setup, as today).

## 3. Isolation requirements
- One git worktree and one `hydra/gp-<race>-<entrant>` branch per entrant; nothing touches your branch until you accept one result.
- Every process tree in its own OS job object (Windows) or process group (POSIX), as for normal tasks; cancelling the race ends all entrants.
- Dependency links into your project stay read-only check-copy links (never in agent worktrees), as today.
- Concurrency limited by the existing agent slots; a race never blocks your other tasks indefinitely (it queues like normal tasks).
- High-risk tasks are not raced: the plan-approval gate applies per entrant, and Grand Prix refuses tasks classified high-risk.
- Losing entrants' worktrees are removed at the end, or kept on request for inspection.

## 4. Metrics

| Dimension | Metric | Source |
|---|---|---|
| **Correctness (gate)** | All required checks pass on the final commit; no check definitions modified; no outside links | Hydra's evidence |
| Quality | Blind review verdict and findings by severity; scope adherence (files touched vs plan); tests added or weakened (flagged) | Reviewer output, diff analysis, existing approval warnings |
| Speed | Wall time from start to verified result; time per stage | Stage records |
| Cost | Reported cost; tokens (input/output, unpriced Codex tokens shown separately) | Usage records |
| Reliability | Fix rounds needed; crashes, provider limits, timeouts during the race | Runs and failure categories |

**Ranking rule:** only entrants that pass the correctness gate can win. Among those, rank by review quality, then by time, then by cost. The person can pick weights (for example "cheapest verified result"), and the rule used is always shown. **The fastest car does not win if its result fails verification**; if no entrant passes, there is no winner and the race says so.

## 5. Recommendation versus race

| Situation | Hydra does |
|---|---|
| Quick question, routine change | Scout suggestion only (no extra quota) |
| You want to know which setup suits a kind of task in your project | Offer a Grand Prix with an estimate; run only on approval |
| Risky change | No race; normal Safe-mode flow |
| Not enough history | Scout says so plainly and uses the stated rule |

## 6. How outcome intelligence supports it
- Every race entrant produces a normal outcome record, tagged with the race id, so Scout learns from races and from everyday tasks alike.
- Records hold only metadata (category, setup, time, cost, verification, decision, failure category), never prompts, code or answers; they stay local and can be cleared.
- Displayed numbers are always observations with counts ("6 of 7"), never confidence scores.

## 7. Data model (planned)
- `races`: id, created, task category, base commit, check digest, entrants (setups), budget, status, winner (or none), weights used.
- `outcomes.race_id` (nullable) to link entrants.
- Each entrant is a normal task with `raceId`, so the existing pipeline, evidence, review and approval code is reused unchanged.

## 8. Interface (planned)
- A track with one lane per entrant; the car advances through sectors as stages complete (PLAN, IMPLEMENT, REVIEW, VERIFY); a failed verification shows a pit stop, not a finish.
- An always-available text table with the same information (accessibility), and a reduced-motion setting.
- Original artwork and code only; no third-party racing visuals or assets.

## 9. Roadmap
1. **Done:** outcome records; Scout-style suggestion in the composer; isolation, OS-enforced process cleanup, Hydra-run verification.
2. **Next (engine):** race entity; entrants as linked tasks; same-base worktrees; captured check digest; blind review; ranking rule with the correctness gate; cancel-all.
3. **Then (UI):** approval dialog with quota estimate; text results table; winner offered for normal approval.
4. **Then:** animated track (optional, reduced-motion aware).
5. **Later:** repeated heats and per-project leaderboards from accumulated races, still shown as counts.

Approval needed before building or shipping a live race: it consumes the customer's own provider quotas by design.
