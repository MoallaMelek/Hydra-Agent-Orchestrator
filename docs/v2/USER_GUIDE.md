# Hydra — User guide

Hydra lets AI coding agents (Claude Code and Codex CLI) answer questions about your code and change it **without touching your branch until you approve a verified result**.

## 1. Install
**Requirements:** git, and at least one of the agent CLIs below. Installers exist for Windows 10/11 x64, macOS (Apple silicon) and Linux x64 (Debian/Ubuntu `.deb`, AppImage). They were installed and launched on fresh CI machines; only Windows has also been used daily.

- **Windows:** run `Hydra-Setup-<version>-x64.exe` (installs for your user only). Builds are **unsigned**, so SmartScreen warns you: choose *More info → Run anyway* only if the file came from the official source.
- **macOS:** open the DMG and copy Hydra to Applications. Unsigned: right-click Hydra → *Open* the first time.
- **Linux:** `sudo apt install ./hydra-desktop_<version>_amd64.deb`, or make the AppImage executable and run it.
- **From source:** `npm install`, `npm run build`, then `npm run desktop`.

## 2. Connect your agents (your accounts, your bill)
Hydra does not include or resell AI access. It drives the CLIs installed on your computer, signed in with your own accounts. The **Get started** panel on first launch shows what is missing:

| Agent | Install | Sign in |
|---|---|---|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | run `claude` and follow the prompt (or set `ANTHROPIC_API_KEY`) |
| Codex CLI | `npm install -g @openai/codex` | `codex login` |

Press **Re-check** afterwards. Hydra only asks each CLI "are you signed in?". It never reads, stores or sends your keys, tokens or account details. To disconnect an account, sign out in the CLI (`claude auth logout`, `codex logout`); Hydra has nothing to revoke.

## 3. Ask or change: one box
Add a project (any folder; changes need a git repository with at least one commit), then type in **Ask a question or describe a change**. Hydra shows how it will handle the message before you send it:

| Hydra picks (Auto) | When | What happens |
|---|---|---|
| **Quick answer** | Greetings and general questions | One agent replies; the reply appears as it is written. |
| **Code question** | Questions about this repository | One agent reads the files it needs (read-only), then replies. |
| **Full change** | Requests to change code ("fix…", "add…", a bug report) | Plan → isolated edit → independent review → Hydra runs your tests → you approve. |

You can override Auto with the buttons under the box. Requests that look **risky** (deleting data, secrets, production, force-push) always stop for you to approve the plan first, whatever you choose. If you send a question as a change, Hydra simply answers it.

For changes, choose how much freedom the agents get:
- *Safe*: you approve the plan and the exact check commands before any code is written.
- *Developer*: agents work on their own inside the isolated copy.
- *Autonomous*: larger budgets and more fix rounds.

Every mode needs your final approval. *Agents and limits* (folded by default) sets which agent plans, codes and reviews, and the cost and time limits.

## 4. Conversations and history
- Under an answer, **Ask a follow-up** continues the conversation; the agent sees the earlier questions and answers.
- **Make this change** turns a question into a full change.
- The project page lists your history as conversations, with **search** (questions, answers and changes) and paging.
- **Archive** hides a conversation without deleting it; *Archived* shows and restores them. **Delete** asks first and removes the task and its logs (changes you accepted stay in your repository).
- *Settings → Export as JSON* saves everything; *Back up now* saves a copy of the database.

## 5. Reviewing a change
When a change says **Review result**:
- **Overview:** the plan, the review findings, and **Before → after**. Hydra ran your project's tests on the original commit and on the result.
- **Changes:** the exact diff. **Checks:** every command Hydra ran itself, with exit codes, the commit and the full log.
- **Warnings** appear above all of this, for example failing or missing checks, modified tests, changed build files or a same-provider review.

Then choose:
- **Accept** fast-forwards your branch to exactly the commit you reviewed. If your branch moved meanwhile, Hydra merges your changes into the task, re-runs the checks and asks you again.
- **Request changes** sends your note to the implementer; the change is reviewed and verified again.
- **Reject** discards the isolated copy. **Keep branch** leaves a `hydra/…` branch for you to merge yourself.

**Roll back** an applied change at any time. Hydra adds a revert commit; your history is never rewritten.

## 6. Your phone
**Phone access is off until you turn it on** (Remote devices → Phone access: 1 hour, 8 hours or until Hydra closes; showing a pairing code also turns it on for an hour). It turns itself off when the time is up and is always off when Hydra starts.

*Remote devices → Pair a phone.* Choose what the phone may do (view; start/cancel; approve/reject) and, if your computer has several networks, pick the one your phone is on (usually Wi-Fi). Scan the QR code with the phone **on the same Wi-Fi**, or through your own VPN such as Tailscale. Check that the code on the phone matches the desktop's.

- Everything between phone and computer is end-to-end encrypted; no cloud service is involved.
- The phone works while Hydra is running on the computer. If it disconnects, it reconnects and catches up on what it missed.
- Revoke a phone at any time; it is cut off immediately. Pairings expire after 30 days.

## 7. Where your data lives
Everything is local: `%LOCALAPPDATA%\Hydra\v2` on Windows, `~/Library/Application Support/Hydra/v2` on macOS, `~/.local/share/hydra/v2` on Linux (readable only by your user on macOS and Linux). That includes the SQLite database (backed up daily into `backups/`), the per-task worktrees and the check logs. Prompts go only to the AI providers you selected, through your own accounts. Hydra has no telemetry.

## 8. Verification commands
On the project page, **Verification** lists the commands Hydra runs on every change and where they come from (your list, `.hydra/checks.json`, or automatic detection). You can add, edit, reorder and remove commands, mark them required, **Test** one on a copy of your last commit, or restore automatic detection. Your list is kept in Hydra, not in your repository. Commands that delete files, change permissions, publish or use the network are refused.

## 9. Updates
Settings → Updates → *Check for updates* asks the release server only when you press it. Updates must be signed by the Hydra publisher and match their checksum, and nothing is installed without you. (Signed releases are not set up yet.)

## 10. Troubleshooting
| Symptom | What to do |
|---|---|
| A provider shows "Not signed in" | Run its sign-in command in a terminal, then *Re-check*. |
| A task is **Paused**: "not accepting work right now" | Your provider account hit a usage or rate limit. Resume later, or use another provider. |
| "Your working tree has uncommitted changes" on Accept | Commit or stash your own work; Hydra never overwrites it. |
| "No checks detected" | Add `.hydra/checks.json` listing the commands that verify your project, for example `{"checks":[{"label":"tests","kind":"test","argv":["npm","test"]}]}`. Node, Python, Go, Rust, Java and C/C++ are detected automatically. |
| Hydra was closed during a task | The task is paused with completed stages kept; press **Resume**. |
| The phone cannot open the pairing page | Same Wi-Fi? Pick another address under *Network* when pairing, and allow Hydra through the firewall on private networks. |
| "Process … did not exit … may still be running" | An agent ignored the stop request; end it in Task Manager / Activity Monitor. |
