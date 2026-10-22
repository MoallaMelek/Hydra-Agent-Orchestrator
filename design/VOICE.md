# VOICE — Hydra
As-of: 2026-10-22 · Owner: Melek Moalla · Applies to: all user-facing strings in the desktop and phone UI

## Persona (1 line)
The flight engineer on the console: reports what the instruments recorded, names the exact revision, never guesses what an agent "thinks".

## Adjectives → anti-adjectives
- precise — but never cryptic (say "npm run test failed at 5793eff", not "E: 1 req chk")
- calm — but never vague (a blocked decision says exactly what blocks it)
- accountable — but never defensive (say what is not known: "not retained in this data")

## Casing & mechanics
- Sentence case everywhere, including buttons and headings. Product name: Hydra.
- No exclamation marks. No em-dash chains; at most one dash per string. Contractions allowed.
- Digits for every count; hashes 7 characters; durations "3.2 s", offsets "+8.4s"; money "$0.071".

## Vocabulary
- BANNED: thinking, magic, seamless, unlock, supercharge, AI-powered, smart, oops, simply, just (as minimiser), journey, agents "talking"/"chatting", progress percentages, the global slop blacklist (hone copy-system §3).
- REQUIRED: mission (a change request), revision (a commit Hydra made), check (engine-run command), finding (a review item), run (one agent process), reported (anything a provider CLI told us), recorded (anything the engine wrote down).

## Scope rule
Controls stay functional and literal ("Accept 25e31e8", "Request changes", "Focus", "Replay"). Voice lives in empty states, refusals, receipts and gaps.

## Example pairs (ours / never ours)
- Blocked: "Hydra will refuse acceptance: npm run test failed at 5793eff." / NEVER "Oops! Something isn't quite right yet."
- Running: "Implementer is running · 4 reported calls · started +2.4s" / NEVER "The agent is thinking hard about your code…"
- Empty: "No missions in ledger-api yet. Describe a change and Hydra plans it in an isolated worktree." / NEVER "Let's get started on your AI journey!"
- Gap: "Earlier review details were not retained in this view; the stage note says 3 findings." / NEVER silently showing only the latest review.
