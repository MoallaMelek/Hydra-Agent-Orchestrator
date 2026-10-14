# Hydra v2 — Security audit

Status labels: **DONE** (fixed and covered by a regression test that fails on the old code), **OPEN** (known, not fixed), **ACCEPTED** (documented residual risk).

## Reviews performed

| # | Date | Reviewer | Scope | Independence | Result |
|---|---|---|---|---|---|
| A1 | 2026-10-13 | Codex CLI (read-only sandbox) | Engine: isolation, verification, apply, adapters, budgets | Independent model, no write access | 11 findings, all fixed (DECISIONS D-013) |
| A2 | 2026-10-13 | Claude (self-review) | Remote host | **Not independent** | 4 findings fixed (D-014) |
| A3 | 2026-10-13 | Codex CLI (read-only sandbox) | Mobile remote control: `remote.ts`, `server.ts`, `security.ts`, `secure-channel`, store acks, docs | Independent model, no write access; reproduced 5 issues with in-memory harnesses | 7 findings, all fixed (D-015); 5 doc corrections made |
| A4 | 2026-10-14 | Codex CLI (read-only sandbox) | Adaptive execution: router and risk gate, streamed answers and redaction, pre-started agents, process runner, remote replay, follow-ups, archive (`git diff 7267bb7..5f976e1`) | Independent model, no write access; reproduced 4 issues with in-memory harnesses | 6 findings (1 High, 4 Medium, 1 Low), all fixed (D-016) |
| A5 | 2026-10-14 | Codex CLI (read-only sandbox) | Pre-beta sprint: job objects, phone access, link screening, sweep, provider failures, router, check validation, outcomes, updater (`git diff 1b95e21..27a89aa`) | Independent model, no write access; probed the router and validator | 10 findings (3 High, 6 Medium, 1 Low): 9 fixed, 1 partly (A5-4) |

No external human penetration test has been performed. That remains a release blocker for a paid product (see COMMERCIAL_READINESS.md).

## A3 findings — mobile remote control

Each fix has a regression test. Before committing, the tests were run against the previous `remote.ts`/`server.ts`: all 9 new tests failed on the old code and pass on the new code.

| ID | Severity | Finding | Fix | Regression test | Status |
|---|---|---|---|---|---|
| R1 | High | A device revoked between handshake and authentication still got a session; sessions outlived device expiry | Device state is re-read from the database at authentication and **before every request**; a 60-second sweep closes expired or revoked sessions (close code 4403) | `remote.test.ts` › refuses a device revoked between the handshake and authentication; ends a live session as soon as the device expires | DONE |
| R2 | High | An unauthenticated request target such as `GET http://[` made `new URL()` throw and crashed hydrad (both the LAN host and the local API) | `safePath()` never throws; malformed targets get 400 (HTTP) or are refused (upgrade); `clientError` and socket `error` handlers added | `server.test.ts` › survives a malformed request target instead of crashing | DONE |
| R3 | Medium | A local WebSocket sending JSON `null` as its first frame crashed the stream handler | Auth frame shape validated before property access; closes 4400 | `server.test.ts` › closes a stream whose first frame is JSON null and keeps serving | DONE |
| R4 | Medium | Two concurrent commands with the same id both executed (duplicate tasks, double spend) | In-flight map keyed by device and id shares one execution; completed acks are recalled from the store | `remote.test.ts` › runs a command once when the same id arrives twice concurrently | DONE |
| R5 | Medium | The handshake limiter stored every rejected attempt (memory growth, quadratic scan) | Fixed-size `{windowStart, count}` per IP; at most 2048 tracked addresses, after which new addresses are refused | `remote.test.ts` › keeps the handshake limiter bounded under many source addresses | DONE |
| R6 | Medium | No outbound backpressure or in-flight bound; unbounded snapshots | A slow consumer is terminated once its buffer passes 8 MB; at most 8 in-flight requests per session; at most 3 sessions per device (oldest closed with 4409); remote snapshots carry at most 200 tasks and no device list | `remote.test.ts` › throttles a flooding phone…; keeps at most three sessions per device… | DONE |
| R7 | Medium | Every command ack was stored permanently, including forbidden ones (disk exhaustion by a view-only device) | Only successful acks are stored; acks over 16 KB are stored without a result; 7-day retention; at most 1000 per device | `remote.test.ts` › stores acknowledgements only for successful commands, within a bounded size | DONE |

### Documentation corrections from A3

| Claim | Was | Now |
|---|---|---|
| REMOTE.md: idempotency per `(deviceId, id)` | Not true under concurrency | True (R4); only successful acks are kept, for 7 days |
| REMOTE.md / THREAT_MODEL T10: revocation and expiry bound access | Race and no session expiry | True (R1) |
| THREAT_MODEL T8: Origin allowlist | Only checked on WebSocket upgrades | Now checked on every HTTP request too; regression test added |
| THREAT_MODEL T11: per-room limits and relay authentication | Described a relay that does not exist | Rewritten to describe the LAN host's real limits; relay marked not implemented |
| REMOTE.md: events forwarded | Said task, run and evidence only | Lists project events too (they are forwarded by design) |

### Not established by A3

The reviewer reported no concrete handshake/KDF flaw, reflection, nonce reuse, command-scope bypass, path traversal, stored XSS or Electron shell escape. This is the absence of a finding by one reviewer, not proof of absence.

## A4 findings — adaptive execution

| ID | Severity | Finding | Fix | Regression test | Status |
|---|---|---|---|---|---|
| A4-1 | High | Streamed answers could show a multi-line secret (a private key arriving line by line) before redaction could recognise it; the stored answer was redacted, hiding the exposure | Only whole words are streamed; everything from an unclosed `-----BEGIN …-----` is held until its `-----END …-----`; if redaction would ever change text already shown, streaming stops for that run (the stored answer is still redacted whole) | `review-fixes.test.ts` A4-1: unit cases, and a key streamed in 9-character pieces with 120 ms pauses (intermediate flushes) | DONE (the old code had no separate function to test against; the failure was reproduced by the reviewer) |
| A4-2 | Medium | Destructive wording outside the pattern list ("Remove all records from the users table") skipped the forced plan approval | Destructive verb near a data object in either order, whitespace normalised; **and** the plan itself is checked: a risky plan stops for approval in every mode | `route.test.ts` new cases; A4-2 (plan-based escalation) | DONE (A4-2 fails on the old code) |
| A4-3 | Medium | A cancelled run could orphan a pre-started process | Cancellation is checked before a pre-started process is claimed, and a claimed process is always cleaned up | A4-3 (real child process) | DONE (fails on the old code) |
| A4-4 | Medium | After the stop deadline, output from a process that would not stop kept being parsed into an abandoned queue | Listeners are detached and further output is drained and discarded | A4-4 (stand-in process that ignores stops) | DONE (fails on the old code) |
| A4-5 | Medium | On a phone reconnect, a live event could overtake the replay and make it skip the missed events; incomplete catch-up was reported as complete | `EventSequencer`: live journal events are held during catch-up and applied after it in order, once; incomplete catch-up is reported | `sequencer.test.ts` (the reviewer's exact scenario) | DONE |
| A4-6 | Low | Archiving a follow-up whose first message was deleted partly succeeded, then failed | Only existing tasks are traversed; deleting a message re-links its follow-ups to the one before it | A4-6 | DONE (fails on the old code) |

Also from A4: earlier answers given to follow-ups are now fenced as untrusted data (they were written after reading repository files).

## A5 findings — pre-beta sprint (process containment, phone access, links, router, checks, updater, outcomes)

| ID | Severity | Finding | Fix | Regression test | Status |
|---|---|---|---|---|---|
| A5-1 | High | The risk gate missed "Remove all files", "Delete src/ recursively", "Disable access control", "Change login to accept any username"; the plan gate ignored the plan's own risk list | Bulk and path deletion, recursive deletion and protection-weakening patterns; the plan gate also reads `plan.risks` | `route.test.ts` (`REVIEW_PROBES`: 15 risky, 8 everyday look-alikes, written after the review, so a regression set, not an accuracy measure); `review-fixes.test.ts` A5-1 (risk named only in the plan's risk list) | DONE. Dev 98.7% and held-out 94.7% unchanged, 0 risky requests missed. Still pattern-based: unseen wording can be missed (the plan gate and final approval remain) |
| A5-2 | High | Turning phone access off left sockets still in their handshake open; one could finish signing in afterwards and keep command access | Every upgraded socket is tracked and terminated when access stops; a generation counter stops a socket from an earlier access period from authenticating or sending requests | `remote.test.ts` A5-2: access turned off and on between key exchange and sign-in | DONE (fails on the old code: the socket stayed open until the handshake timeout, code 4408) |
| A5-3 | High | Link screening normalised paths lexically, so `alias -> .` plus `docs/leak -> ../alias/../secret` passed both the checks and Accept | Targets are resolved component by component through every link in the destination tree, as the filesystem does; cycles and over-long chains count as outside | `links.test.ts` A5-3 (real git) and resolution-rule cases | DONE |
| A5-4 | Medium | Windows: a child can start descendants in the instant before it is put in its job; those were outside the job | On cancel, the live tree is also ended by parentage (`taskkill /T`) before the job is terminated; the engine-wide job still ends everything when the engine exits | Existing real-process tests | PARTIAL: Node cannot create a process already inside a job (or suspended), so a descendant that starts in that instant **and** whose parent has already exited could survive until the engine exits. Not reproduced |
| A5-5 | Medium | Cleanup success was overstated: POSIX reported success when the parent exited even if descendants ignored SIGTERM; a failed job query read as "empty"; callers ignored the result | POSIX requires the whole process group to be gone (escalates to SIGKILL); an unreadable job is "unknown"; incomplete cleanup is reported in the run's and the check's result | `containment.test.ts` grandchildren now report their pid only once they ignore signals (the old test could pass by killing them during start-up); CI on macOS and Linux | DONE |
| A5-6 | Medium | The start-up sweep followed a leftover copy that was a link and could remove the project's own linked `node_modules` | Each leftover is `lstat`ed; a link is unlinked without being entered; a copies folder that is itself a link is left alone | `links.test.ts` A5-6 (two cases) | DONE (both fail on the old code; the old code emptied the temporary test project through the link) |
| A5-7 | Medium | `git -C <dir> clean -fdx` passed check validation (only the second argument was examined); the editor implied stronger protection than a denylist gives | Forbidden subcommands are matched in any argument; the editor and the guide say checks run with your permissions and that the denylist is a safety net, not a sandbox | `custom.test.ts` (four commands with options first) | DONE for the reported bypass. Renamed programs and script files still bypass a denylist (ACCEPTED, documented) |
| A5-8 | Medium | A download could hang forever on a disk error or a stalled server | Each write is awaited and fails on error; the response and every read have a deadline | `updater.test.ts` A5-8 (stalled server, unwritable folder) | DONE |
| A5-9 | Medium | Downloads were written to the final, predictable name, following a link placed there; concurrent downloads clobbered each other | Exclusive, randomly named `.part` file; verified and closed before being renamed into place (a link at the final name is replaced, never written through); file names must be plain names (no `.`/`..`) | `updater.test.ts` A5-9 and file-name cases | DONE (fails on the old code: the linked file was overwritten) |
| A5-10 | Low | Kept branches (untested, not accepted) counted as successes in the outcome history and could drive recommendations | Only accepted changes whose checks did not fail count as successes; kept branches are not observations | `outcomes.test.ts` A5-10 | DONE |

A5 also noted test blind spots, now partly addressed: pending handshakes (A5-2), chained links (A5-3), link roots in the sweep (A5-6), git global options (A5-7), unverified kept branches (A5-10), disk errors, links and stalls in the updater (A5-8/9). Still not covered: FFI load failure on a packaged build, the job-assignment race (A5-4), HTTPS redirects in the updater, a real phone session.

CI found one more defect during this round, unrelated to A5: on macOS/Linux, `C:\...\curl.exe` was not recognised as `curl` by the check validator (`path.basename` keeps backslashes there). CI had been red on macOS/Linux for commits 2cb317a to cd9ee7b because of it. Fixed in e75be53.

## Residual risks (ACCEPTED, documented)

| Risk | Where documented | Mitigation available to users |
|---|---|---|
| Phone UI is served over plain HTTP on the LAN; an active LAN attacker could tamper with the JavaScript before it runs | REMOTE.md, THREAT_MODEL T20 | Use a trusted network or a VPN such as Tailscale. HTTPS needs an owner-approved relay or certificate. |
| The per-launch API token is visible to same-user processes (Electron `additionalArguments`) | THREAT_MODEL T8 | Same-user processes are outside the trust boundary on desktop OSes |
| Verification runs project code with the user's privileges | THREAT_MODEL T5 | Safe mode binds check definitions; container profile planned |
| A Windows descendant started in the instant before its parent entered a job, whose parent then exits, can outlive a cancelled run until the engine exits (A5-4) | THREAT_MODEL T16 | Job objects, `taskkill /T` on cancel and the engine-wide job; reported when cleanup is incomplete |
| A check (or a script it runs) can do anything the user can; the command denylist is a safety net, not a sandbox (A5-7) | USER_GUIDE section 8, the Verification panel | Only add commands you trust; OS-level isolation for checks is future work |
| Unsigned installers trigger SmartScreen / Gatekeeper warnings | RELEASE_CHECKLIST.md | Owner must obtain code-signing certificates |
| An unlocked, already-paired phone can act until revoked or expired | REMOTE.md | `approve` scope is opt-in; revoke from Devices |

## Open before a paid release

- External human penetration test of the remote channel and installer (OPEN).
- Code signing for Windows and macOS, and macOS notarization (OPEN, needs owner certificates).
- Security disclosure address: a mailbox the owner controls must be chosen (OPEN, see BETA_TEST_PLAN.md).
