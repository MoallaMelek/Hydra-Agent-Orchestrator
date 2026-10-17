# Decisions (ADR log)

Current clarification (2026-10-17): historical entries below describe their decision dates. The container profile is not implemented. Final approval may include failed or missing checks; only the recorded commands can be said to pass. Codex tokens can be unpriced. Desktop update preferences can now schedule checks/downloads, with installation always explicit. These corrections supersede contrary wording in D-004/D-010/D-022. See PRODUCT_MILESTONE.md and AGENSI_FULL_PRODUCT.md for current capabilities and release gates.

Format: ID · date · decision · alternatives considered · why · consequences. Newest last.

### D-001 · 2026-10-13 · New codebase on branch `v2-rebuild`
- Written from the product requirements; the earlier implementation is not part of the codebase.
- Consequences: root workspaces list only `packages/*` and `apps/*`; `npm run provenance` checks originality.

### D-002 · Engine-first architecture (headless daemon plus thin clients)
- Alternatives: logic inside the Electron main process (the earlier shape); Tauri with a Rust core.
- Why: one engine with a typed API can be tested without a GUI, driven by the phone through the same command set, and scripted from a CLI. Tauri/Rust was rejected for now: no Rust toolchain on the build machine and much slower iteration. The engine API keeps that option open later.
- Consequences: desktop and phone share one SPA; the engine is a plain Node library and process.

### D-003 · SQLite through `node:sqlite`, with an event journal plus projections
- Alternatives: JSON files (the earlier version: whole-file rewrites); better-sqlite3 (native addon to rebuild per Electron ABI); LevelDB.
- Why: transactional durability, cheap appends, queryable history, no native build step. `node:sqlite` is built into Node ≥22.13 without a flag (verified on 22.23.2).
- Consequences: requires Node ≥22.13 for hydrad. Electron's embedded Node must provide `node:sqlite`; verify at M3, with a fallback of running hydrad on a bundled Node runtime.

### D-004 · Isolation by git worktree per task; apply only on human Accept; rollback by revert
- Alternatives: edit the user's tree directly (the earlier version); copy the project directory; container-only isolation.
- Why: worktrees are cheap and native to the developer's workflow, give exact SHAs for evidence, and make discard trivial. Revert-based rollback never destroys user history.
- Consequences: implement tasks require a git repository with at least one commit. Uncommitted user changes are not visible to agents (shown in the UI).

### D-005 · Verification is run by the engine, not by agents
- Alternatives: parse agent tool events for test commands (the earlier version); trust agent claims.
- Why: this removes a whole class of false "verified" results and the review deadlock found in the audit (reviewers asked for tests they could not run).
- Consequences: Hydra executes project test code. This is mitigated by approval in Safe mode, a scrubbed environment, timeouts, and the optional container profile, and documented as a residual risk.

### D-006 · Claude agents never get a shell
- Why: Claude Code has no OS sandbox. With `--restricted` its file tools are confined to the working directories. Shell work, where needed, goes to Codex, whose sandbox is OS-enforced.
- Consequences: Claude is excellent for plan, review and implement (edits); verification is engine-run anyway, so nothing is lost.

### D-007 · Self-hostable zero-knowledge relay plus end-to-end encryption (no cloud database)
- Alternatives: a hosted cloud database; LAN-only; third-party tunnels (Tailscale, Cloudflare Tunnel); WebRTC.
- Why: a hosted database would store prompts and terminal output in plaintext on someone else's infrastructure. A relay that only moves ciphertext lets the owner host it anywhere, or nowhere (LAN only).
- Consequences: public deployment of a relay needs the owner's approval and infrastructure. Until then remote is verified on localhost and LAN only and labelled as such.

### D-008 · Structured agent outputs through provider-native schema enforcement
- Why: `claude --json-schema` and `codex exec --output-schema` validate at the source. Hydra validates again with zod and allows one corrective retry. There is no regex routing.

### D-009 · TypeScript 6.0.x, React 19, Vite 8, Vitest 5, zod 4, Electron 44
- Why: current stable versions. TypeScript 7 (Go-native) was skipped because typescript-eslint supports TS <6.1 today.

### D-011 · 2026-10-13 · Backend ownership: no cloud database; remote transport needs owner approval (owner requirement)
- Requirement: all infrastructure must be under Melek Moalla's control; $0/month during development; no paid resources or deployments without approval.
- Decision: all persistent state (tasks, journal, evidence, devices, audit) lives in **local SQLite** on the customer's machine, with migrations, online backups and restore. There is **no cloud database at all**. Remote control uses an end-to-end-encrypted channel; transport options, in order:
  1. **Direct/LAN** (phone ↔ hydrad over the local network or the customer's own VPN such as Tailscale): $0, no cloud, implemented first.
  2. **Self-hosted relay** (`apps/relay`, stateless, ciphertext only): runs on any machine the owner controls (Docker); can later be deployed to an owner-controlled free tier (e.g. Cloudflare Workers/Durable Objects or a free VM). **Not deployed. Requires the owner's explicit approval and account.**
  3. A hosted backend (e.g. Firebase) was considered and **not recommended**: its server functions need a billing-enabled plan, which conflicts with "no surprise charges".
- Consequences: no cloud SDK or configuration in Hydra. Build outputs are scanned for secrets.

### D-012 · 2026-10-13 · Customer authentication and billing isolation (owner requirement)
- Decision: Hydra is orchestration software, not an inference provider. Each customer's own Claude Code and Codex CLIs authenticate with the customer's own accounts and credential stores. Hydra never stores, proxies, packages or transmits provider credentials. It only asks each CLI whether it is signed in (`claude auth status`, `codex login status`) and keeps just `authenticated` plus a sanitized method label; email, organisation and plan fields are dropped at parse time.
- Enforced by: (a) `agents/auth.ts` parsers (unit-tested to drop identity fields); (b) no credential fields anywhere in the SQLite schema or protocol; (c) a packaging test that scans build output for credential files and token patterns (`~/.claude`, `~/.codex`, `.env`, `sk-…`, JWT-like strings); (d) a store test asserting no credential patterns in the database after runs; (e) remote commands cannot read provider status beyond the boolean.
- Cross-customer isolation: each installation runs as the local OS user and only invokes that user's CLIs. There is no shared server or account pool, so one customer's account cannot be reached by another. Tests check that Hydra adds no credential environment variables and that the remote channel cannot request environment or credential data.

### D-010 · npm workspaces (no pnpm)
- Why: npm ships with Node, pnpm is not installed on the build machine, and contributors need fewer tools.

### D-013 · 2026-10-13 · Engine hardening after independent Codex review (consultation round 1)
- Context: a fresh, read-only Codex CLI session (no prior context) reviewed `packages/engine` and recommended "request changes" with 25 findings.
- Accepted and fixed:
  - Git metadata redirection: every worktree git call is pinned with `--git-dir/--work-tree` recorded at creation, and the `.git` pointer and HEAD branch are verified first. `GIT_*` variables are stripped.
  - Hooks and fsmonitor are disabled for every engine git call (`core.hooksPath` points at an empty per-process directory).
  - Accept is bound to the reviewed commit (`task.decide.headSha`, required); stale decisions are refused.
  - Apply and rollback are serialized per repository (`KeyedMutex`). Apply cannot be canceled midway. A durable `applyIntent` is written before touching the user's branch and reconciled after a crash.
  - Apply is **always a fast-forward of a verified tree**. If the user's branch moved, Hydra integrates it into the task branch, re-verifies, and asks for a fresh decision. "Already contains it" is recorded as `method: none`.
  - Checks run in a throwaway checkout of the exact SHA. Tracked-file mutation is detected per check (`treeMutated`). Dependency links exist only in those checkouts, never in agent worktrees.
  - Safe-mode approval is bound to a digest of the check definitions (scripts and build files). Changed definitions are not executed in Safe mode and are flagged in other modes.
  - Single engine per data directory (`engine.lock`). Recovery kills orphaned agent PIDs only after confirming the image is `claude`/`codex`.
  - Agent env is an allowlist: system and toolchain variables plus *only that provider's* variables. Checks get no provider credentials.
  - Secret redaction on stored and broadcast output; per-check log quota; log stream errors handled; realpath-based cwd confinement.
  - Codex usage counts as `unpricedTokens` (token-bounded) instead of $0. Budget limits are inclusive and rechecked after waiting for a slot. A run cannot outlive the remaining active-time budget.
  - `putRun` is transactional; the Maven/Gradle wrapper path bug is fixed; the demo uses the latest verify attempt.
- Rebuttal and residual (documented, not fixed now):
  - Windows descendants whose parent exited cannot be reliably killed without Job Objects (native code). POSIX uses process groups. → THREAT_MODEL T16.
  - Stage outputs and stage completion are separate transactions; a crash between them re-runs that stage (idempotent re-run, wasted tokens, no safety impact).
  - Git clean/smudge filters configured by the user still apply to engine checkouts. → T17.
  - Checks run project code with the user's privileges; the optional container profile is the mitigation (not yet implemented). → T5.

### D-014 · 2026-10-13 · Remote host hardening (self-review; independent review blocked)
- The planned second independent Codex review of the remote channel could not run: the Codex account hit its usage limit. It is **still owed** before release.
- Self-review (not independent) found and fixed: (1) **pairing race**: two phones completing the handshake on one link could both register; pairings are now claimed atomically at authentication (regression test added); (2) expired pairings were never pruned, and open pairings are now capped at 10; (3) the per-IP handshake-attempt map is pruned; (4) a per-session token-bucket rate limit (30 burst, 10/s) applies after authentication.
- Noted residual: the per-launch API token reaches the renderer through Electron `additionalArguments`, visible in the process command line to same-user processes (already T8).

### D-015 · 2026-10-13 · Remote control hardening after independent Codex review (A3)
- The review owed by D-014 ran (Codex CLI, read-only sandbox). It reported 7 findings (2 High, 5 Medium) and 5 incorrect documentation claims; details and tests in SECURITY_AUDIT.md.
- Accepted all 7 findings; no rebuttal was needed. Each fix has a regression test that was confirmed to fail on the previous code.
- Design choices: device state is read from SQLite on every remote request rather than cached (one indexed lookup; correctness over micro-optimisation). Only successful command acks are persisted, because a failed command has no side effect to protect and storing failures let a view-only device grow the database. When the handshake table is full, new addresses are refused rather than evicting active ones; a determined LAN attacker can therefore delay new pairings by up to a minute (T11 residual).
- Origin is now checked on every local HTTP request, not only WebSocket upgrades (T8 correction).

### D-016 · 2026-10-13 · Adaptive execution: deterministic routing, streamed answers, pre-started agents
- Problem: simple questions felt slow. Measured baseline: Hydra's own overhead was ~10 ms, but answers were returned as structured JSON (nothing visible until the end, ~5 s for "hi"), every question paid ~3–4 s of CLI start-up, and questions sent as changes went through the pipeline.
- Alternatives considered: (a) a model call to classify each request (adds seconds, defeats the purpose); (b) keeping one long-lived Claude session per project (faster, but context carries over between unrelated tasks); (c) disabling tools or lowering effort for quick answers (measured: no gain).
- Decision: a deterministic classifier shared by UI and engine; plain-text streamed answers; single-use pre-started read-only processes (no shared context). Risk is classified separately and enforced in the engine.
- Consequences: the answer schema (`keyFindings`, `filesReferenced`) is gone; answers are Markdown. The classifier is heuristic: misrouting a change as a question costs one cheap reply and the user can press "Make this change"; misrouting a question as a change ends with the planner replying. Its accuracy was measured only on a 30-case table written alongside it.

### D-017 · 2026-10-13 · The repository contains only Hydra v2 (owner request)
- The archived earlier implementation, its audit and the provenance write-up were removed from the tree; `main` was fast-forwarded to the v2 branch (no force-push; history kept). A private copy of the provenance evidence and a full history bundle are kept on the owner's machine.
- The originality check still runs in CI: it compares the code against the archived implementation in git history (tag) instead of a folder.

### D-018 · 2026-10-14 · OS-enforced process cleanup on Windows via job objects (koffi)
- Problem: on Windows, descendants whose parent had exited survived cancellation (T16). Mocked tests could not show this; real-process tests did.
- Alternatives: a compiled native addon (needs a compiler on every build machine); a PowerShell helper per spawn (adds latency and stdio plumbing); `taskkill /T` only (misses orphans).
- Decision: `koffi` (MIT, prebuilt per platform, no compiler) to call kernel32 job-object functions. Each spawned child gets its own kill-on-close job; the engine binds itself to a kill-on-close job so a crash ends its children. Only the current platform's binary ships (about 3 MB). If it cannot load, fall back to `taskkill /T` and report it.

### D-019 · 2026-10-14 · Phone page integrity: minimise exposure (no HTTPS yet)
- A page served over HTTP cannot prove its own integrity, and HTTPS that phones trust without warnings needs a public domain and certificates (infrastructure: owner approval). Self-signed certificates teach users to click through warnings.
- Decision: phone access off by default, explicit and time-limited, bound to one address, with a trusted-network warning. Options for a full fix are left to the owner: a domain with automated certificates, or a native phone app.

### D-020 · 2026-10-14 · Verification commands editable in the app, stored in Hydra
- Stored in Hydra's database rather than written into `.hydra/checks.json`, so agents cannot alter them and the user's working tree stays untouched. Precedence: your list, then the project file, then detection. Destructive, privilege, publishing and network commands are refused; desktop only.

### D-021 · 2026-10-14 · Outcome history and recommendations: transparent statistics, not machine learning
- Local records of finished tasks (metadata only). A stated rule until a setup has at least 5 similar observations, then the best observed success rate with counts shown. No confidence scores. Clearable by the user.

### D-022 · 2026-10-14 · Updates: signed manifests, checked only on request
- Ed25519-signed manifests (public key in the app), HTTPS only, checksum-verified downloads, nothing run without the user. Background checks would be a network call the user did not ask for, so there are none. Release key, hosting and code signing are owner decisions (blocked).
