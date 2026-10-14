# Execution boundaries: what is enforced, and by whom

Hydra runs AI agents and your project's own commands. This page states, for every way they can act, **what actually enforces the limit**:
- **OS**: the operating system refuses, whatever the program tries.
- **CLI**: the provider's own program enforces it (Claude Code or Codex). Hydra passes the flags and checks the CLI supports them, but cannot see inside.
- **Hydra**: Hydra's engine checks it in its own code.
- **Prompt**: it is only an instruction to the model. Never relied on for safety.

A git worktree is **not** a security sandbox. It isolates *changes* (nothing reaches your branch until you accept), not what a process can read or run.

| Who | What they could try | Limit | Enforced by | What remains possible |
|---|---|---|---|---|
| Claude (agent) | Run shell commands | No Bash/command tool is given (`--tools Read,Glob,Grep[,Edit,Write]`, `--restricted`) | CLI | — (relies on Claude Code honouring its flags; Hydra refuses versions that lack them) |
| Claude (agent) | Read or write files outside the task | File tools confined to the working directory (`--restricted`), edits only with write access | CLI | Reading files inside the project, including ones you would not want in a prompt (for example `.env`) |
| Codex (agent) | Run commands, write files, use the network | `-s read-only` or `workspace-write`, `network_access=false` | OS (Codex's sandbox: Seatbelt on macOS, Landlock/seccomp on Linux, its Windows sandbox) | Whatever Codex's sandbox allows on that platform |
| Any agent | Use your other credentials | Each CLI gets only its own settings and keys; other secrets (cloud keys, tokens, `NODE_OPTIONS`, `GIT_*`) are removed from its environment | Hydra | The CLI's own sign-in, which it needs to work |
| Any agent | Push, merge, touch your branch | Agents work in a separate worktree on a `hydra/*` branch; only Accept fast-forwards your branch to the exact reviewed commit; git hooks are disabled for Hydra's git commands | Hydra | — |
| Any agent | Commit a link that points outside the project (for example to `~/.ssh`) | Checks refuse to run on such a commit, and Accept refuses to apply it | Hydra | Inspecting the branch yourself with Keep branch |
| Verification checks | Run arbitrary code (they are your project's tests and builds) | Run with **your user's permissions**, in a throwaway copy of the exact commit, not in the worktree; environment without provider credentials; working directory confined to the copy; time limit | Hydra (copy, environment, time limit) | Anything your user account can do. Safe mode shows the exact commands for approval first, and refuses to run them if the agent changed them afterwards |
| Verification checks, agents | Leave processes running | Windows: every process tree in an OS job object, terminated on cancel, time-out, completion and engine crash. macOS/Linux: process group, SIGTERM then SIGKILL | OS | POSIX: a process that deliberately starts a new session (`setsid`, daemonising) leaves the group. Windows: if the job API cannot load, Hydra falls back to `taskkill /T` and reports it |
| Risky requests (delete data, secrets, production, force-push) | Run without you seeing the plan | The request **and** the plan are checked; a match stops for plan approval in every mode | Hydra | Pattern-based: risky work phrased without recognisable words is not flagged (final approval still applies) |
| Secrets in output | Appear in answers, logs or evidence | Redaction of common key formats before anything is shown or stored; streamed text is held back until a secret is complete | Hydra | Unknown secret formats |
| Phone access | Reach Hydra from the network | Off by default; on only for a set time; listens on one chosen address; end-to-end encrypted; scoped and revocable devices | Hydra | The phone page is sent without HTTPS: someone controlling the network while it is on could alter it (THREAT_MODEL T20) |
| Hydra after a crash | Leave files or processes behind | Leftover check copies are removed at start (their links into your project are removed first, never followed); interrupted tasks are paused for you to resume; Windows: child processes die with the engine | Hydra, OS | — |

## Why there is no full OS sandbox for checks
Running your tests needs your toolchains, caches and often network access. A real sandbox would mean containers or virtual machines on every platform, which most users do not have, and which would make many projects fail to build. Hydra's choice is to make the commands visible and approvable (Safe mode), run them away from your files, without your provider credentials, under OS-enforced process cleanup, and never apply anything you did not accept. An optional container profile is on the roadmap.
