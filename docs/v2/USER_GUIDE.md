# Hydra v2 — User guide

Hydra lets AI coding agents (Claude Code and Codex CLI) work on your code **without touching your branch until you approve a verified result**.

## 1. Install
**Requirements:** Windows 10/11 x64 (tested), macOS or Linux (builds configured, not yet tested); git; and at least one of the agent CLIs below.

- **Windows:** run `Hydra-Setup-<version>-x64.exe`. Builds are currently **unsigned**, so Windows SmartScreen will warn you; choose *More info → Run anyway* only if you obtained the file from the official source.
- **From source:** `npm install`, `npm run build`, then `npm run desktop`.

## 2. Connect your agents (your accounts, your bill)
Hydra does not include or resell AI access. It drives the CLIs installed on your computer, signed in with your own accounts:

| Agent | Install | Sign in |
|---|---|---|
| Claude Code | per Anthropic's instructions | `claude auth login` (or `ANTHROPIC_API_KEY` in your environment) |
| Codex CLI | per OpenAI's instructions | `codex login` |

Open **Agents & providers** in Hydra to see whether each one is installed, which version, and whether it is signed in. Hydra only asks the CLI "are you signed in?". It never reads, stores or sends your keys, tokens or account details.

## 3. Your first task
1. **Add a project:** the `+` next to *Projects*, then choose a folder. Change tasks need a git repository with at least one commit.
2. **Describe the task** in plain language. Choose:
   - **Kind:** *Change code* or *Ask a question* (read-only).
   - **Autonomy:**
     - *Safe*: you approve the plan and the exact check commands before any code is written.
     - *Developer*: agents work on their own inside the isolated copy.
     - *Autonomous*: larger budgets and more fix rounds.
     - Every mode needs your final approval.
   - **Agents per role:** planner, implementer, reviewer. Using a different provider for the reviewer gives a more independent review.
   - **Budget:** cost and active-time limits. Codex reports tokens but not prices, so Codex is limited by tokens.
3. **Watch it work.** The pipeline shows PLAN → IMPLEMENT → REVIEW → FIX → VERIFY → DEMO → APPROVAL. The *Agents* tab streams output; *Activity* shows every stage.

## 4. Reviewing a result
When a task says **Review result**:
- **Overview:** the plan, the review findings, and **Before → after**. Hydra ran your project's tests on the original commit and on the result.
- **Changes:** the exact diff.
- **Checks:** every command Hydra ran itself, with exit codes, the commit, and the full log.
- **Warnings** appear above all of this. Examples: checks failing or missing, tests modified, build files changed, a same-provider review, regressions.

Then choose one:
- **Accept** fast-forwards your branch to exactly the commit you reviewed. If your branch moved meanwhile, Hydra merges your changes into the task, re-runs the checks, and asks you again.
- **Request changes** sends your note to the implementer; the change is reviewed and verified again.
- **Reject** discards the isolated copy.
- **Keep branch** leaves a `hydra/…` branch for you to merge yourself.

**Roll back** an applied task at any time. Hydra adds a revert commit; your history is never rewritten.

## 5. Your phone
*Remote devices → Pair a phone.* Choose what the phone may do (view; start/cancel; approve/reject), then scan the QR code with the phone **on the same network**, or connected through your own VPN such as Tailscale. Check that the code on the phone matches the one on the desktop. Everything between phone and computer is end-to-end encrypted; no cloud service is involved. Revoke a phone at any time; it is cut off immediately. Pairings expire after 30 days.

## 6. Where your data lives
Everything is local: `%LOCALAPPDATA%\Hydra\v2` on Windows, `~/Library/Application Support/Hydra/v2` on macOS, `~/.local/share/hydra/v2` on Linux. That includes the SQLite database (backed up daily into `backups/`), the per-task worktrees, and the check logs. Prompts go only to the AI providers you selected, through your own accounts.

## 7. Troubleshooting
| Symptom | What to do |
|---|---|
| A provider shows "not signed in" | Run its login command in a terminal, then *Re-check*. |
| A task is **Paused**: "not accepting work right now" | Your provider account hit a usage or rate limit. Resume later, or start a new task with another provider. |
| "Your working tree has uncommitted changes" on Accept | Commit or stash your own work; Hydra never overwrites it. |
| "No checks detected" | Add `.hydra/checks.json` listing the commands that verify your project, for example `{"checks":[{"label":"tests","kind":"test","argv":["npm","test"]}]}`. |
| Hydra was closed during a task | The task is paused with completed stages kept; press **Resume**. |
