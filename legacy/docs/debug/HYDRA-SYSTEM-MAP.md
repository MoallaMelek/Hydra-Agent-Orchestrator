# Hydra system map

Audit snapshot: 2026-09-12, Windows build 10.0.26200.9445.

## What Hydra is

Hydra is a desktop control panel for command-line AI tools. Hydra is not an AI model. It starts and displays Claude Code or Codex CLI processes, remembers their metadata, and routes keyboard or phone input to the selected process.

Claude Code and Codex remain separate programs with separate accounts, models, transcripts, and permission systems. Hydra can put both beside each other, but it does not currently make them collaborate automatically.

## The actual running shape

```text
Hydra development launcher (Node)
└─ Electron main process
   ├─ Electron renderer (the visible desktop window)
   ├─ preload bridge (restricted renderer-to-main API)
   ├─ Hydra daemon client ──Windows named pipe──> detached Hydra daemon
   │                                           ├─ one PTY/shell per live agent
   │                                           │  ├─ Claude Code CLI, or
   │                                           │  └─ Codex CLI
   │                                           └─ local Manager MCP server
   └─ RemoteControlService
      └─ Firebase Auth + Firestore + callable createSession
         └─ Hydra Remote PWA in iPhone Safari/home screen
```

The daemon is deliberately separate from the window. It owns agent terminals and can survive the desktop window closing. Remote Control is different: it lives in Electron main, so it stops when the desktop application closes even if the daemon and agents continue.

## The pieces in plain language

- **Electron main** creates the window, talks to the daemon, owns local services, and owns Remote Control.
- **Renderer** is the visible React interface. It never launches a CLI directly.
- **Preload** exposes a narrow IPC API so the renderer can ask Electron main to act.
- **Daemon** is a detached background Electron-as-Node process. It owns agent PTYs, metadata, output buffers, session discovery, and the Manager MCP server.
- **Claude agent** is a Claude Code CLI inside one PTY and one project directory.
- **Codex agent** is a Codex CLI inside a different PTY and one project directory.
- **Manager** is a specially marked Hydra agent whose workspace contains MCP instructions. Through the local MCP server it can create, prompt, inspect, restart, or stop other agents.
- **Firebase** is the temporary message relay between phone and desktop. It is not the Hydra daemon.
- **Hydra Remote PWA** is the mobile web interface. It reads agent summaries and output from Firestore and writes commands to a session inbox.

## Words that look similar but mean different things

- A **project** is the exact `projectDir` string attached to an agent. Hydra groups cards by that string. On Windows, capitalization differences can form separate groups.
- A **Hydra agent** is one card plus its provider/model/project metadata and, while active, a PTY process.
- A **Claude/Codex session** is the provider's resumable conversation ID and transcript stored in the provider's own user directory.
- The **daemon lifetime** is the lifetime of Hydra's detached local process and in-memory terminal buffers.
- A **remote session** is one temporary Firebase session created by the desktop, normally lasting eight hours in the current configuration.
- A **phone session** is the PWA's Firebase sign-in and listeners for that remote session.

Hydra's workspace file persists its own agent cards, but not pending keystrokes or terminal buffers. Provider transcripts persist separately. Imported provider histories appear as idle cards and do not mean that 132 CLIs are running.

## How a desktop message reaches an agent

```text
selected desktop card
→ renderer useAgents.sendInput
→ preload IPC
→ Electron main IPC handler
→ DaemonClient HTTP request over named pipe
→ daemon AgentManager.sendInput(agent ID)
→ that agent's PTY
→ Claude or Codex CLI
```

Only the selected agent receives a normal desktop message. The separate broadcast action sends the same input to all agents whose `projectDir` exactly matches the chosen project.

## How a phone message reaches an agent

```text
selected phone agent card
→ PWA creates Firestore inbox message containing agentId + input
→ desktop RemoteControlService listener
→ DaemonClient.sendInput(agentId, input)
→ daemon AgentManager
→ that exact agent PTY
```

The phone can target a Claude, Codex, or Manager card that is present in the remote state. A chat message targets one selected agent. The phrase “use Claude and Codex together” has no special meaning: it is just text sent to that one agent unless the selected agent is a working Manager and deliberately uses MCP tools.

## What is automatic today

- Starting and displaying separate Claude/Codex CLI terminals.
- Resuming a provider session when its session ID is known.
- Keeping live agents in the daemon when the desktop is closed in background mode.
- Importing discoverable Claude and Codex histories as idle cards.
- Relaying selected-agent prompts, status, output, and history through a temporary remote session.
- Letting a Manager use local MCP tools when a Manager agent is explicitly created and functioning.

## What is not automatic today

- Claude/Codex planning, implementation, review, repair, verification, demo, or approval workflow.
- Collaboration merely because both providers are visible.
- Safe semantic “wait until agent is complete”; Manager can only poll status/output and notifications.
- Persistent trusted-device pairing across new desktop remote sessions.
- Remote-specific approval decisions with strong, structured identity and audit guarantees.
- iPhone web-push notifications while the PWA is closed.
- Demo recording.
- Windows startup after login.
- Creating or broadcasting to agents from the current phone UI, although protocol handlers exist.

## What to expect after closing or rebooting

- Closing with no active agents stops the daemon.
- Closing with active agents asks whether to stop them or leave them in the daemon. Background mode leaves the CLIs running but destroys Remote Control.
- Reopening connects to a responsive daemon using its lock file and named pipe; the daemon's in-memory buffers are then available again.
- A daemon shutdown kills its PTYs. A daemon crash normally takes its PTY children with it or invokes its shutdown handler, but this should not be treated as durable execution.
- A reboot ends Electron, daemon, and agent processes. There is no Hydra autostart entry on this PC.
- Internet/Firebase loss interrupts phone relay; local desktop-to-daemon operation can continue.
- VS Code does not need to be open, but this PC's Codex executable selection is currently unstable: one successful run used the binary installed inside the OpenAI VS Code extension, while later runs selected the global npm wrapper. The editor UI is not in the launch path, but the extension installation is currently an accidental executable dependency until the global CLI is authenticated and Hydra resolves it deterministically.
