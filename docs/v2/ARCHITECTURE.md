# Hydra v2 — Architecture

> Engine-first. One durable orchestration engine; every surface (desktop, phone, CLI, tests) is a client of the same typed API.

## 1. Goals that shape the design

1. **Nothing reaches the user's working tree without explicit approval.** All agent work happens in a dedicated git worktree on a task branch.
2. **Evidence over claims.** Hydra itself runs tests and builds and records exit codes, output digests and the exact commit they ran against. An agent saying "tests pass" is never evidence.
3. **Durable by default.** Every state change is an append-only event in SQLite. A crash loses at most the in-flight agent run, and the task resumes from its last completed stage.
4. **Provider-neutral orchestration.** The workflow never branches on "Claude" or "Codex". It asks adapters for *capabilities*.
5. **Honest safety.** Each restriction is labelled as enforced by the OS, by the provider CLI, or by a prompt only. See THREAT_MODEL.md.
6. **Owned remote access.** The phone talks to the engine end-to-end encrypted through a relay the owner controls. The relay never sees plaintext.

## 2. System overview

```
 ┌──────────────── desktop (Electron shell, thin) ────────────────┐
 │  BrowserWindow → loads UI from hydrad (127.0.0.1, bearer auth)  │
 │  native: folder picker, notifications, lifecycle               │
 └───────────────▲───────────────────────────────────────────────┘
                 │ HTTP + WebSocket (typed protocol, zod-validated)
 ┌───────────────┴────────────── hydrad (engine host) ─────────────────────────┐
 │ api/        HTTP routes · WS event stream · auth · host/origin checks        │
 │ engine/     Orchestrator ─ WorkflowMachine ─ StageRunners                    │
 │             AgentAdapters (claude, codex) · Budget · Policy (modes)          │
 │             Isolation (git worktrees) · Verification (detectors + runner)   │
 │             Store (SQLite: events, tasks, runs, evidence, devices)          │
 │ remote/     SecureChannel (X25519/Ed25519, XChaCha20-Poly1305) · Devices    │
 └───────────────┬─────────────────────────────────────────────────────────────┘
                 │ WSS (ciphertext only)
        ┌────────┴────────┐            ┌───────────────────────────┐
        │  hydra-relay    │◄──────────►│ phone: same UI, "remote"  │
        │ (self-hosted)   │            │ client over SecureChannel │
        └─────────────────┘            └───────────────────────────┘
```

### Repository layout

| Path | Responsibility |
|---|---|
| `packages/protocol` | Versioned zod schemas: domain types, API requests and responses, event types, remote envelopes. No runtime dependencies other than zod. |
| `packages/engine` | The orchestration engine as a library: store, workflow, stages, adapters, isolation, verification, budget, policy. No HTTP. |
| `packages/secure-channel` | Pairing and session cryptography shared by engine and phone (isomorphic, @noble/*). |
| `packages/ui` | React SPA: design system plus app views. Talks to an `ApiClient` (local) or a `RemoteClient` (encrypted). |
| `apps/hydrad` | Engine host: HTTP/WS API, static UI hosting, remote bridge, CLI entry (`hydrad serve`, `hydrad doctor`). |
| `apps/desktop` | Electron shell: starts hydrad, opens a window, provides native dialogs. |
| `apps/relay` | Zero-knowledge WebSocket relay plus static PWA hosting. Dockerfile included. |
| `skills/` | Standalone Agensi-compatible SKILL.md skills derived from Hydra's methods. |
| `tools/` | Originality check, licence report, release and test helpers. |

## 3. Domain model

```
Project ──< Task ──< StageRun ──< AgentRun ──< (usage, transcript file)
                 ├──< Check  ──< Evidence (exit code, digests, log file, commit SHA)
                 ├──< Finding (review)          ├──< Approval (pre-exec / final)
                 └──  Workspace (worktree path, branch, base SHA, head SHA)
Event (append-only journal: every change above is an event)
Device (paired phone: keys, scopes, expiry, revoked) · AuditEntry
```

Key types live in `packages/protocol/src/domain.ts`. IDs are ULIDs (sortable). All timestamps are ISO-8601 UTC.

## 4. Workflow

### 4.1 Stages and states

`PLAN → IMPLEMENT → REVIEW → FIX → VERIFY → DEMO → APPROVAL → (APPLIED | DISCARDED)`

Task status (`TaskStatus`): `draft · queued · running · waiting_input · paused · completed · failed · canceled`. The current stage is tracked separately (`TaskStage`). `waiting_input` covers both approvals (pre-execution in Safe mode, final approval in all modes) and plan clarification.

The transition function `nextStep(task, outcome)` is **pure**. It takes the persisted task snapshot and the outcome of the last stage and returns the next action (`run_stage`, `await_approval`, `complete`, `fail`). It is exhaustively unit-tested. The orchestrator is the only component that performs side effects.

| Stage | Input | Output (persisted) | Performed by | Failure handling |
|---|---|---|---|---|
| PLAN | prompt, project snapshot, mode | `Plan` {summary, steps[], acceptanceCriteria[], risks[], filesLikelyTouched[]} validated against a JSON schema | Planner agent (read-only), with provider-native structured output (`--json-schema` / `--output-schema`) | 1 corrective retry on schema failure, then `failed` |
| PRE-APPROVAL (Safe only) | Plan + check plan | Approval record | Human | Reject → `canceled` |
| IMPLEMENT | Plan, worktree | Commits on the task branch, run transcript | Implementer agent (write, confined to worktree) | Error or timeout → stage `failed` (retry policy per mode) |
| Pre-review checks | worktree HEAD | Evidence[] | **Engine** (verification runner) | Recorded; failures go to the reviewer and FIX |
| REVIEW | diff base..HEAD, plan, check evidence | `Review` {verdict, findings[] with severity and file} | Reviewer agent (read-only), a different provider when available | Invalid output → 1 retry → `failed` |
| FIX (≤ N rounds) | open findings, failing checks, human feedback | new commits | Implementer | Bounded by `maxFixRounds` and budget; exhausted → `waiting_input` with reasons (never a silent pass) |
| VERIFY | final commit SHA | Evidence[] against that SHA | **Engine** | Any required check failing → back to FIX if rounds remain, else `waiting_input` |
| DEMO | base SHA and final SHA | `Demo` {checkDelta (base vs final), customDemo outputs} | **Engine** | Best-effort; failure is recorded, not fatal |
| APPROVAL | everything above | decision: accept · request_changes · reject · keep_branch | Human (desktop, or phone with `approve` scope) | — |
| APPLY | final SHA | merge commit or fast-forward in the user's repository plus a rollback record | Engine (git) | Conflict → nothing applied, branch kept, user informed |

### 4.2 Why verification is engine-run

Agents can lie, misreport, or run a different command than claimed. In v2 the engine runs the detected checks itself, in the task worktree, at a known commit, with a scrubbed environment, a timeout and process-tree cleanup. It records `{argv, cwd, commitSha, exitCode, durationMs, stdout/stderr digests and tails, log file}`. Review sees these results, so reviewers never need to "run tests" themselves.

### 4.3 Checkpointing and recovery

- Each stage completion appends `stage.completed` with its outputs **in the same SQLite transaction** that updates the task projection.
- On engine start, `Recovery.reconcile()` finds tasks that were running. The interrupted `AgentRun` is marked `interrupted`, its process tree is killed if still alive (PID plus start-time check), and the task becomes `paused` at the stage that was running. **Resume** re-runs only that stage; completed stages are not repeated. The worktree persists across restarts.
- Idempotency: stage runners key their outputs by `(taskId, stage, attempt)`.

### 4.4 Concurrency

- A global scheduler limits concurrent agent runs (default 3) and concurrent tasks (default 4).
- Tasks are isolated by worktree, so two tasks on the same project can run in parallel safely. APPLY is serialized per project (mutex) and requires a clean target tree.

### 4.5 Adaptive execution (routing)
Not every message needs the pipeline. `routeRequest()` in `packages/protocol/src/route.ts` is a deterministic classifier (regular expressions, under 0.5 ms, no model call). The UI runs it live to preview the route; the engine runs it again when it creates the task, and only the engine's result counts.

| Depth | Typical message | Execution |
|---|---|---|
| `fast` | greeting, general question | one read-only agent call, plain-text reply streamed token by token; the prompt says to open files only if needed |
| `standard` | question about this repository | one read-only agent call, streamed; reads the files it needs |
| `deep` | request to change code, bug report | PLAN → IMPLEMENT → REVIEW → FIX → VERIFY → DEMO → APPROVAL |

- **Risk is independent of depth.** A request that matches the high-risk patterns (deleting data, secrets, production, force-push, `sudo`…) and becomes a change always runs in Safe mode (plan approval), whatever mode or depth the user picked.
- **Users may override** the depth (Quick answer / Code question / Full change). Overrides never remove the risk gate.
- **Auto never fails a change in a folder without git**: it answers instead. A forced change there is refused with an explanation.
- **The planner may answer.** If a "change" turns out to be a question, the planner returns a reply instead of a plan; the task finishes as answered and the unused worktree is removed.
- **Follow-ups** (`task.followUpOf`) give the agent up to four earlier question/answer pairs.

**Streaming.** Answers are plain text (`--include-partial-messages` for Claude), published as `run.output` events with `stream: 'answer'`. Text is redacted before it is published; an unfinished run of token-like characters is held back until it ends, so a secret split across chunks is never shown. The stored answer is redacted as a whole. Codex replies arrive at the end (its CLI does not stream text).

**Pre-started agents.** Starting the Claude CLI takes seconds. The Claude adapter can start an answering process ahead of time (`--input-format stream-json`, same restricted read-only flags as any answer, spend cap $2). It is used only for plain-text read-only answers in the same directory whose own budget is at least that cap. At most two exist; each expires after 5 minutes idle; all are stopped when the engine closes. The composer pre-starts one when you focus it, and each answer pre-starts the next.

Measured (TEST_EVIDENCE, real Claude): "hi" went from 5.1 s to 3.4 s total (median), with the first words after 2.5 s once warm. Hydra's own overhead is about 10 ms; the rest is the provider.

## 5. Agent adapter layer

```ts
interface AgentAdapter {
  id: ProviderId; displayName: string
  probe(): Promise<ProviderStatus>              // installed, version, path, capabilities, notes
  capabilities: { structuredOutput: boolean; osSandbox: boolean; fileToolConfinement: boolean;
                  reportsUsage: boolean; reportsCost: boolean; resumable: boolean }
  run(req: AgentRunRequest, signal: AbortSignal): AsyncIterable<AgentEvent>
}
type AgentEvent = { type: 'started', pid } | { type: 'text', text } | { type: 'tool', name, summary }
  | { type: 'usage', inputTokens, outputTokens, cachedTokens, costUsd? }
  | { type: 'structured', value } | { type: 'error', message, retryable } | { type: 'finished', status }
```

| Concern | Claude Code adapter | Codex CLI adapter |
|---|---|---|
| Invocation | `claude -p --output-format stream-json --verbose --restricted --safe-mode --strict-mcp-config --permission-prompts none --no-session-persistence` | `codex exec --json --ephemeral -C <worktree> -s <read-only\|workspace-write>` + `approval_policy="never"`, network disabled |
| Read-only roles | `--tools Read,Glob,Grep --permission-mode dontAsk` | `-s read-only` |
| Write roles | `--tools Read,Glob,Grep,Edit,Write --permission-mode acceptEdits`; `--restricted` confines file tools to cwd = worktree | `-s workspace-write` (OS sandbox on macOS/Linux; Windows sandbox per Codex) |
| Shell for the agent | **never** (no Bash; Claude has no OS sandbox) | inside the Codex sandbox only, network off |
| Structured output | `--json-schema` | `--output-schema <file>` |
| Usage and cost | `result.usage`, `total_cost_usd` | `turn.completed.usage`; cost estimated from a configurable price table (labelled *estimate*) |
| Budget cap | `--max-budget-usd` + engine-side abort | engine-side abort |
| Prompt delivery | stdin (never argv, never a shell) | stdin (`-`) |

A `scripted` adapter (deterministic, file-driven) exists **only for tests** and is never registered in production builds.

## 6. Isolation (git worktrees)

- Implement tasks require the project to be a git repository with at least one commit. Analyze-only tasks can run on any directory with read-only roles.
- `Workspace.create(task)` records `baseSha = HEAD`, then runs `git worktree add -b hydra/<task-short-id> <dataDir>/worktrees/<taskId> <baseSha>`.
- Uncommitted changes in the user's tree are **not** carried into the worktree. The UI states this explicitly.
- After each agent stage, the engine commits the worktree state (`hydra: <stage> (<agent>)`) under a Hydra author identity, so every stage has a SHA.
- **Accept**: if the user's branch HEAD == baseSha and the tree is clean → fast-forward. Otherwise → `git merge --no-ff` of the task branch. On conflict → `merge --abort`; the branch is kept and reported.
- **Rollback** (after accept): a `git revert` of the merge or range, as a new commit. It never resets or rewrites user history. Offered only while the revert applies cleanly.
- **Discard**: remove the worktree and delete the task branch (only branches created by Hydra, `hydra/*`).
- Protected roots: refuse home directories, drive and filesystem roots, system directories, and Hydra's own data directory.

## 7. Verification engine

Detectors (`packages/engine/src/verification/detectors/*`) each inspect a project and return `CheckSpec[]`:

| Ecosystem | Signals | Checks (argv, no shell) |
|---|---|---|
| Node/TS/JS | package.json; lockfile picks npm/pnpm/yarn/bun | scripts `typecheck`, `lint`, `test`, `build` when defined; `CI=1` in env to avoid watch mode |
| Python | pyproject/setup.cfg/pytest.ini/tox.ini/tests dir | `python -m pytest -q` (or `unittest discover`), `ruff check`/`mypy` if configured |
| Go | go.mod | `go build ./...`, `go vet ./...`, `go test ./...` |
| Rust | Cargo.toml | `cargo build`, `cargo test` |
| Java | pom.xml / build.gradle(.kts) | `mvn -B test` / `gradlew test` (wrapper preferred) |
| C/C++ | CMakeLists.txt / Makefile with `test` target | `cmake -S . -B <tmp>`, `cmake --build`, `ctest`; `make test` |
| Custom | `.hydra/checks.json` in project | user-declared argv lists (validated) |

The runner spawns with `shell:false`. On Windows, `.cmd`/`.bat` shims are run through `cmd.exe /d /s /c` only after every argument passes a strict character allowlist. Runs have per-check timeouts, process-tree kill, a scrubbed environment (allowlist: PATH, HOME, temp, locale, toolchain variables), output capped in memory, and full logs on disk with a SHA-256 digest.

Execution profiles: `host` (default) and `container` (optional: `docker run --network none` with the worktree mounted; used when Docker is available and the user selects it). The host profile runs project test code with the user's privileges; this is stated in the UI and in THREAT_MODEL.md.

## 8. Autonomy modes (enforced by `Policy`, not by prompts)

| Mode | Pre-exec approval | Agent write scope | Check approval | Fix rounds | Budget default | Final approval |
|---|---|---|---|---|---|---|
| Safe | **required** (plan + checks) | worktree only | required | 1 | $2 / 30 min | required |
| Developer | no | worktree only | detected checks auto-approved | 2 | $5 / 60 min | required |
| Autonomous | no | worktree only | auto-approved | 4 | $15 / 120 min | required |

No mode gives an agent a shell outside an OS sandbox, network access, or access to other projects. No mode applies changes without a human decision.

## 9. Persistence

SQLite through Node's built-in `node:sqlite`, so there is no native addon to rebuild. WAL mode; `PRAGMA user_version` migrations in `packages/engine/src/store/migrations/*.ts`. Tables: `events`, `tasks`, `stage_runs`, `agent_runs`, `checks`, `evidence`, `findings`, `approvals`, `workspaces`, `devices`, `audit`. Large blobs (transcripts, logs) live as files under `<dataDir>/blobs/` and are referenced by digest.

## 10. API (hydrad)

- Binds `127.0.0.1` on an ephemeral port. A per-launch 256-bit bearer token is required on every request. The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (DNS-rebinding defence). WebSocket `Origin` must match.
- `GET /api/state` · `GET /api/projects` · `GET /api/tasks?project=` · `GET /api/tasks/:id` · `GET /api/tasks/:id/events?after=` · `GET /api/tasks/:id/diff` · `GET /api/evidence/:id/log` · `GET /api/providers` · `POST /api/commands` (a discriminated union of commands, each answered with an ack).
- `WS /api/stream?after=<seq>`: ordered events with resume.

## 11. Remote control

See `docs/v2/REMOTE.md` for the protocol. Summary: device pairing by QR (one-time secret, 5-minute TTL); per-device static keys; per-connection ephemeral keys; XChaCha20-Poly1305 frames with counters; commands acknowledged by id and idempotent; scopes `view | control | approve`; device expiry (30 days default) and revocation; a relay that only routes ciphertext by room and rate-limits.

## 12. Desktop shell

Electron hosts the UI in a sandboxed renderer (`contextIsolation`, no Node integration). A minimal preload exposes `pickDirectory()`, `notify()` and the API endpoint and token. hydrad runs as a separate Node process supervised by the shell. If the window closes while tasks are running, the user chooses whether hydrad keeps running.
