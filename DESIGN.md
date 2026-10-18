# Hydra Workroom

Alpha.5 extends the Mission Desk with a deep pine navigation rail, conversation canvas, bounded pending decisions, compact current work and an artifact-derived Proofline. Clickable proof nodes select and focus existing inspectors. Stale/untrusted artifacts are labeled explicitly; native buttons/lists/disclosures preserve keyboard semantics. Three concept comparisons and safe skill choices are recorded in docs/v2/PRODUCTION_PREPARATION.md. No continuous idle animation or new dependency was introduced.

Operate mode. The signature interaction is the transition from a request to a revision-bound mission receipt and a human decision. It is a readable record, not a progress spectacle. Conversation, request, result, evidence, decision is the reading order. Technical inspection is disclosed.

Slate surfaces and a sage signal are implemented in packages/ui/src/app/mission.css. Light uses pale mineral surfaces and a dark green action color. Existing Terracotta is preserved. Status colors keep their meanings: amber for attention, red for failure, green for observed passing evidence. Labels always accompany color. Original Hydra mark and system typography remain. No downloaded fonts, decorative images or new UI library.

The compact project rail supports return visits; Workspace starts with a project-aware composer. Request and receipt shapes are distinct. Account details, project checks and operations use native disclosures. Settings/system pages retain their ledger structure. At narrow widths the rail becomes a menu, receipt fields stack, and controls wrap. Keyboard focus and native dialogs remain visible and named. Tab groups support arrows/Home/End. Reduced motion suppresses movement; collapsed operations unmount and do not keep a drawing clock alive.

## Interaction review

| Before | After | Why |
|---|---|---|
| Slot board and competing diagrams first | Conversation and mission receipt first | Explain the task before the machinery |
| Composer focus prestarts a provider | Focus edits a local draft | Avoid surprising background work |
| Waiting approval counted as live drawing | No approval drawing tick; details unmounted | Idle work should settle |
| Failed/absent checks may still read verified | Exact-revision evidence state beside acceptance | Confidence must follow observed evidence |
| Technical capabilities precede setup | Account setup before disclosed capabilities | Help the user get to a working account |

Rendered verification, sizes, themes and remaining limitations must be recorded with the milestone evidence; this document alone is not an accessibility or performance certification.
