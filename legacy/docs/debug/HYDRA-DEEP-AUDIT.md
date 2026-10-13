# Hydra deep audit

Audit snapshot: 2026-09-12. This section records the system before cleanup or the fixes proposed below. Repository `MelekCreed/Hydra-Agent-Orchestrator` (then a clone of the upstream project), branch `main`, commit `d8ad561`, had pre-existing uncommitted Remote Control/Windows compatibility work.

## 1. Environment and observed state

| Item | Observed value |
|---|---|
| OS | Windows 10.0.26200.9445, 25H2, x64-class installation |
| Git | 2.51.2.windows.1 |
| Node.js | 22.16.0 |
| npm | 10.9.2 |
| Claude Code | 2.1.269; first-party Claude account reports logged in |
| Codex CLI | Global npm CLI 0.154.0 reports not logged in; the OpenAI VS Code extension's bundled CLI is 0.154.0-alpha.6.2 and also reports not logged in when invoked standalone. A prior real Hydra run succeeded with `gpt-5.6-sol`, so executable path and inherited auth context require a fresh end-to-end check |
| Hydra | package 0.2.61; development command `npm run dev` |
| YOLO | globally off and off for every observed Hydra agent |
| Autostart | no Hydra user Run value, Startup shortcut, or matching scheduled task found |

At the snapshot the detached daemon was PID 14900 and reported healthy, Manager MCP listening on loopback, 132 agent records, and one active agent. The persisted workspace contained 11 Hydra test/baseline cards, all for `C:\Users\moall\hydra`; 121 additional idle records came from imported provider history. The only active Hydra-owned CLI was one Claude smoke-test session. No Hydra-owned Codex CLI and no Manager agent were active.

### Actual Hydra-owned process tree

PIDs are a point-in-time snapshot and will change after restart.

| Process | PID | Parent | Role/status | Safe to terminate? |
|---|---:|---:|---|---|
| `node.exe` | 2344 | 9284 | npm/development launcher; active | Yes, to close the dev app after preserving intentional work |
| `node.exe` | 24936 | 2344 | development wrapper/child; active | Yes, with the launcher |
| `electron.exe` | 22884 | 24936 | Electron main; active | Yes, but doing so ends Remote Control |
| `electron.exe` | 13924 | 22884 | desktop renderer; active | Yes, with Electron main |
| Electron helpers | 4368, 5468, 20888 | 22884 | GPU/utility helpers; active | Yes, with Electron main |
| `esbuild.exe` | 23284 | 24936 | dev bundler helper; active | Yes, with dev launcher |
| `electron.exe` | 14900 | detached | Hydra daemon (Electron-as-Node); healthy | Only after handling live agents |
| `cmd.exe` | 11332 | 14900 | shell wrapper for Hydra Claude agent | Yes: the card is an obvious smoke test |
| `claude.exe` | 16632 | 11332 | Claude CLI for `hydra-smoke-check`; live | Yes: obvious smoke test, no useful task identified |
| `conhost.exe` helpers | multiple | 14900 | Windows ConPTY helpers | Yes, only with their daemon/PTY |

Other `codex.exe` processes on the machine belong to the current Codex/ChatGPT product process tree, not Hydra. They are not stale Hydra agents and must not be terminated as cleanup.

## 2. Process and session architecture

Electron main uses `ensureDaemon()`. If a daemon lock points to a responsive named pipe, it reconnects; otherwise it removes a stale lock and spawns a detached daemon with `ELECTRON_RUN_AS_NODE=1`. Renderer requests go through the context-isolated preload IPC surface, then a `DaemonClient`, then HTTP/WebSocket over the named pipe.

The daemon creates `AgentManager`, provider session catalogs, workspace/config stores, notifications, headless runs, and `HydraMcpServer`. `AgentManager` starts one node-pty PTY per active agent. On Windows a direct executable spawn often fails with error 193 and Hydra intentionally retries through `cmd.exe`; those messages are fallback events, not separate user sessions.

The workspace store persists metadata only: agent ID/name/provider/model/project/session ID/status-like fields. On hydration processes are not silently recreated. Imported provider histories are idle resumable records. Each provider's transcript lives in its own standard local storage, and terminal output buffers are daemon RAM capped at about two million characters per running agent.

### Why old entries and duplicate projects appeared

Three independent behaviors combined:

1. `importSessionsOnStartup` is enabled with a limit of 500 per provider.
2. Startup builds catalog options with limit, project prefix, and hidden IDs, but accidentally omits `sessionMaxAgeDays`; the documented seven-day limit is therefore not applied during startup import.
3. `sessionImportProjectPrefix` and `defaultProjectDir` are empty, so histories from every discoverable project are eligible.

Hydra groups projects by the exact stored `projectDir`. Windows paths that differ only in drive-letter casing become separate groups. The `Documents\Codex\...` entries are real historical Codex working directories discovered from Codex's session catalog; they are not copies of this repository and are not live processes.

## 3. The `/rename hydra-smoke-check` root cause

This was not restored terminal input, Hydra transcript replay, or another agent. `AgentManager.spawnProcess()` schedules `/rename <agent name>` for every named Claude agent 1.5 seconds after spawn/resume. User/remote input is independently queued and submitted with Enter (twice for Claude). If input arrives before Claude's rename composer is committed, the new text can merge with that pending command. Restarting a named Claude agent schedules the rename again, which makes it look like an old command returned.

Hydra's input queue is in memory and does not persist across daemon restarts. The observed behavior is a deterministic startup timing race between Hydra's delayed rename command and the first real prompt.

## 4. Routing

### Desktop

`App`/`useAgents.sendInput` targets the selected agent ID, preload invokes the input IPC handler, main calls `DaemonClient.sendInput`, the daemon route calls `AgentManager.sendInput`, and the manager writes to that agent's PTY. There is a separate project broadcast path using exact `projectDir` equality.

### Phone

The PWA writes `{type:'prompt', payload:{agentId,input}, processed:false}` to the remote session inbox. Electron main's `RemoteControlService` listens for unprocessed inbox documents, marks them processed, then calls `DaemonClient.sendInput(agentId,input)`. A normal chat message targets exactly one currently selected card. Claude, Codex, and Manager can all be selected if present. The current phone UI exposes prompt, stop, and restart. Its protocol and desktop service also understand create and broadcast, but the PWA currently provides no create/broadcast controls.

Saying “use Claude and Codex together” to a normal agent does not invoke orchestration. It is ordinary prompt text delivered only to that selected agent.

## 5. Current orchestration capability

| Capability | Supported? | Detail |
|---|---|---|
| Manager can list agents | YES | `hydra_list_agents` MCP tool |
| Manager can create Claude/Codex agents | YES | `hydra_create_agent` accepts provider; tool description/examples contain stale model wording |
| Manager can message one agent | YES | `hydra_send_prompt` |
| Manager can inspect output | YES | `hydra_get_output` reads recent terminal buffer |
| Manager can wait for semantic completion | NO | No wait/completion tool; it must poll status/output or react to notifications |
| Manager can broadcast | YES | Exact project-directory group |
| Manager can restart an agent | YES | `hydra_restart_agent` |
| Manager can stop an agent | YES | `hydra_kill_agent` |
| Ordinary agents can message one another directly | NO | They receive no peer transport by default |
| Claude can directly invoke Codex | NO | Only a Manager equipped with Hydra MCP can mediate |
| Codex can directly invoke Claude | NO | Only a Manager equipped with Hydra MCP can mediate |
| Manager can recursively create Manager agents | NO | Created agents force `isManager:false` |

The MCP service was running at audit time, but no Manager agent existed, so end-to-end Manager behavior was not yet verified.

## 6. Model routing

Claude's built-in choices are aliases `opus`, `sonnet`, and `haiku`. Hydra passes the selected string as `--model`; provider availability still depends on the signed-in Claude account.

Codex normally queries the installed CLI's `app-server` `model/list` method, filters hidden entries, and caches the result for five minutes. If that query fails, Hydra silently substitutes a static fallback list in `shared/types.ts`. That fallback currently marks `gpt-5.3-codex` as the default and contains stale entries. Imported Codex histories are also stamped with this fallback default because session summaries do not contain the actual historical model.

The CLI launch always includes the agent state's model. Hydra does not implement a launch-time fallback from one model to another. Therefore `gpt-5.3-codex` failed because the ChatGPT-authenticated Codex service rejected that obsolete account/model combination; `gpt-5.6-sol` worked because it is supported for the account. Old imported cards may display misleading model metadata, and resuming one can explicitly request that stale model. Terminal model detection can update the displayed state only after recognizable CLI output appears.

There is a second independent Codex issue on this PC: Hydra's `where codex` preflight has resolved different executables on different launches. The successful baseline log used the native `codex.exe` bundled inside the OpenAI VS Code extension; later logs used the extensionless global npm shim and fell back through `cmd.exe`. This makes authentication/model behavior path-dependent and explains why a working ChatGPT-backed run can coexist with a failing standalone login status. A reliable baseline must choose the official global Windows wrapper deterministically and authenticate it explicitly, or document the extension binary dependency.

## 7. Daemon and failure lifecycle

- Closing the window with active agents triggers a confirmation. “Quit and stop” kills agents and the daemon. “Leave running” disconnects the UI and keeps daemon PTYs alive.
- With no active agents, closing Electron stops the daemon.
- Reopening Hydra connects to the existing named pipe if the lock is live and retrieves current agents and in-memory buffers.
- `RemoteControlService` belongs to Electron main and is destroyed on window/app shutdown. It does not survive in the detached daemon.
- Daemon graceful shutdown persists agent metadata and calls `killAll()` before stopping MCP/server.
- An uncaught daemon exception invokes shutdown; an unhandled rejection is only logged. A hard process/OS failure is not durable execution.
- A renderer crash can leave Electron main and daemon alive; a main-process crash ends Remote Control while detached agents may remain.
- Internet/Firebase failure stops remote delivery but not local daemon/PTY operation. The PWA may show stale/disconnected state based on the 45-second heartbeat rule.
- Reboot ends all these processes. No Windows autostart is configured.

The Windows logs contain repeated `AttachConsole failed` failures from node-pty termination. The first immediate `killPtyProcess()` in `AgentManager.kill()` is not protected by `try/catch`, unlike later force-kill paths. This can escape and destabilize the daemon during cleanup.

## 8. Remote Control data flow and payload bug

Electron creates a session via a callable Firebase function and receives separate custom tokens for host and mobile. Desktop signs in with the host token; the QR/mobile link carries the mobile custom token in the URL fragment. The PWA exchanges it for Firebase credentials, verifies the root session document, sends a handshake, then listens to agent state and the latest 100 outbox documents.

Data sent to Firebase:

- Root session metadata: timestamps, expiry/status, host name/presence, mobile presence, heartbeat, and agent count.
- Agent state documents: Hydra ID, name, provider, model, project path, provider session ID, status, and timestamps.
- Inbox: phone prompt text and supported control payloads, timestamps, and processed flag.
- Outbox: raw incremental PTY output chunks, status events, notification metadata, and requested parsed conversation history.

Data that stays local unless included above includes project file contents, daemon output buffers as a whole, credentials used by Claude/Codex, and provider transcript files themselves. However, prompt/output text can naturally contain file contents or secrets; Remote sends that output, and `get_history` sends parsed transcript message content.

Output is accumulated per agent and flushed approximately every two seconds, so ordinary output writes are incremental batches, not full terminal snapshots. Conversation history is different: `AgentChat` requests history on mount/agent switch, and the desktop reads and sends the full parsed transcript again in a new outbox document.

The 1 MB Firestore error has a concrete cause. `writeOutbox()` uses `JSON.stringify(payload).length` against a 50,000 threshold, which measures UTF-16 characters rather than UTF-8 bytes. More importantly, its truncation branch only truncates a `lines` array. Conversation history uses a `messages` array, so the code adds `truncated:true` but leaves the full messages untouched and still attempts the write. Large full transcripts therefore exceed Firestore's document limit, and repeated history requests repeat the oversized write.

## 9. Firebase and security model

Both the desktop and deployed PWA are configured to use the upstream maintainer's Firebase project. The PWA's static files are hosted at the separate user-owned no-billing project/site `hydra-remote-moalla-260912.web.app`. Thus both projects are involved: user hosting serves files, while Auth, Firestore, and Functions traffic goes to the maintainer backend.

The callable function creates a random Firestore session and two custom auth users. Both tokens contain only the same `sessionId` authorization claim; UID names differ, but rules give host and mobile identical read/write access to the root session and all `state`, `inbox`, and `outbox` documents. Another unauthenticated user cannot enumerate/read a session under the rules; anyone who steals a valid mobile credential/link can read its remote data and inject any supported inbox command during token validity.

Configured session expiry is 480 minutes. The desktop heartbeat is 15 seconds; the PWA requires an active session and a recent heartbeat. A scheduled function deletes expired sessions hourly. These expiry/presence checks are client/application behavior, not enforced in Firestore rules.

Important security gaps:

- Firestore rules check only the token's session ID. They do not require the parent session to exist, be active, or be unexpired.
- Desktop `disable()` deletes the root document but not subcollections. Firestore deletion does not cascade. The scheduled cleanup queries root documents, so already-orphaned subcollections may never be selected; an existing ID token can retain rule-authorized access.
- Host and phone do not have least-privilege roles.
- The callable `createSession` has no visible caller authentication or App Check requirement, creating resource-abuse exposure on the maintainer project.
- Manager MCP listens only on `127.0.0.1`, but has no additional authentication; another local process able to reach it can control agents.

Fixing rules/functions requires control of the maintainer backend and a security deployment. That was intentionally not attempted.

## 10. QR and pairing persistence

The current QR is an HTTPS link to the deployed PWA. The temporary mobile custom token is stored after `#` so it is not sent in the HTTP request. The PWA locally extracts the session ID from the token payload only to locate the document; Firebase verifies the signed token during `signInWithCustomToken`. The address fragment is removed after successful authentication.

The PWA stores the full link/token in `localStorage` and can reconnect on reload while the same desktop remote session remains active. It is initial pairing for one remote session, not trusted-device pairing. A new Electron launch creates a new Firebase session/token, so the phone must scan or open the new link again. Persistent pairing is technically possible but would require a deliberately designed device identity, revocation, role-separated authorization, and credential storage; simply reusing the current token indefinitely would weaken security.

## 11. Phone UI semantics

- The agent list is the Firestore `state` collection for the currently paired desktop remote session. An agent card is a Hydra agent summary, not proof that its CLI is currently alive; inspect status.
- Selecting a card opens chat for that exact agent. Back returns to the list and allows switching.
- “Responding now” and “Streaming reply” are UI inferences derived from a locally pending prompt, recent terminal output, and nonterminal status. They are not provider-native structured completion events.
- Chat merges requested transcript history, locally stored pending user bubbles, and heuristically parsed raw terminal output.
- Stop and restart are available from the phone. Create and broadcast are not exposed in the current phone UI.
- There is no structured remote permission-approval surface, Manager creation flow, settings editor, filesystem diff/review view, push notification subscription, or demo recorder.

## 12. VS Code and fixed project use

VS Code does not need to be running. `defaultEditor:'vscode'` affects only “Open in,” and Claude/Codex launch from the daemon using each agent's `projectDir`. However, the currently successful Codex path came from the installed OpenAI VS Code extension, so uninstalling that extension can presently change behavior. After the global CLI is authenticated and executable resolution is made deterministic, it will be valid to boot Windows, launch Hydra directly, leave VS Code closed, create agents in `C:\Users\moall\hydra`, and use Remote while Electron main remains running.

## 13. Security threat classification

No audited code path had YOLO enabled. Ordinary Claude/Codex agents can still request or execute powerful shell/file operations according to their own permission model; remote prompts are not a safety boundary.

### CRITICAL

No demonstrated unauthenticated remote-code-execution path was found in the inspected configuration. The system should nevertheless not be considered safe for unattended privileged operation until the high-severity items are addressed.

### HIGH

- A stolen mobile link/token has the same session-level Firestore permissions as desktop and can inject supported commands.
- Firestore rules do not enforce session existence, active status, expiry, or role; orphaned subcollections can outlive root deletion and token access can continue.
- Full transcript content is uploaded on history request without a working byte bound, causing both data-exposure and >1 MB failures.
- Remote text goes directly into a powerful interactive agent. Prompt injection from repository content or remote input can induce destructive shell/file actions subject only to the CLI's permission UX.
- Hydra has no structured, authenticated remote approval protocol; terminal rendering on a phone is not a trustworthy substitute for an explicit approval system.

### MEDIUM

- Loopback Manager MCP is unauthenticated and offers create/prompt/broadcast/kill/restart controls to local processes.
- Publicly callable session creation lacks visible App Check/caller authentication, risking backend resource abuse.
- Stale agents may continue unattended if the user chooses background quit; Remote itself ends, making monitoring less obvious.
- Windows `cmd.exe` fallback adds an additional quoting/parsing layer. Provider executable/model/arguments are program-controlled or user-selected, but custom model strings and future untrusted inputs must remain argv-validated and must never be assembled as a shell command string.
- The node-pty `AttachConsole` termination failure can destabilize cleanup and leave state confusing.
- The phone persists its complete temporary pairing credential in same-origin local storage, which increases impact of a same-origin XSS or device compromise.

### LOW

- Exact-string Windows project grouping produces duplicate-looking paths.
- Imported sessions display a fallback model rather than the actual historic model.
- “Streaming” indicators are heuristic and can misstate semantic completion.
- Remote inbox documents are marked processed before command execution is confirmed, so failures are not acknowledged end to end.
- Desktop/daemon logs and provider transcripts contain operational metadata and prompts; local account/file permissions remain important.

## 14. Pre-fix cleanup classification

| Class | Records/processes | Planned treatment |
|---|---|---|
| Safe test/debug | 11 persisted cards with baseline/toolchain/verification/smoke provenance, including the one live Claude smoke process | Remove Hydra workspace references and stop the one live smoke PTY after documenting and hardening kill handling; do not delete provider transcripts |
| Imported history | 121 idle catalog records across historical working directories | Do not delete transcripts; narrow import configuration and restart so unrelated records are not imported |
| Active useful | None identified in the Hydra-owned tree | Preserve all unrelated machine processes |
| Unknown | Non-Hydra Codex/ChatGPT product processes | Do not terminate or alter |

## 15. Safe-fix plan justified by the audit

1. Apply `sessionMaxAgeDays` in daemon startup import and cover it with a test.
2. Narrow this PC's default project and import prefix to `C:\Users\moall\hydra` without deleting underlying histories.
3. Replace the stale Codex fallback default with a currently supported model and test selection behavior; retain runtime catalog as primary source.
4. Resolve the global Windows Codex wrapper deterministically instead of alternating between npm and an editor extension; verify/authenticate it with the user's ChatGPT account.
5. Bound all Remote outbox payloads by UTF-8 bytes, specifically truncate conversation history by messages/content, and test the actual serialized size.
6. Catch Windows PTY termination failures at the first kill attempt and test that agent cleanup does not escape.
7. Prevent first prompts from racing the automatic Claude rename, using explicit startup sequencing rather than relying on a longer arbitrary delay.
8. Clean only the documented smoke/baseline workspace cards, restart on the fixed daemon, and create exactly one fresh Claude and one fresh Codex baseline agent with YOLO off.

Backend authorization/rule redesign, persistent device pairing, autonomous orchestration, startup automation, remote approvals, push, and demo recording are outside safe local fixes and remain future work.
