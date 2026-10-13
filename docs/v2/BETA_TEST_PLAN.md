# Hydra v2 — Closed beta test plan

Status: **draft, not started.** No testers have been invited and no build has been distributed. Both need the owner's approval (see "Before inviting anyone").

## 1. Goal and scope

Find out whether developers can install Hydra, connect their **own** Claude Code or Codex account, and complete supervised changes on real repositories without losing work. The beta is not about scale.

- Size: 5–10 invited developers, 2 weeks.
- Distribution: private download links to the unsigned CI-built installers. No public release, no store listing, no auto-update.
- Cost to the owner: $0. Testers pay for their own provider usage through their own accounts. Hydra holds no keys of yours or theirs.

## 2. Platform matrix

| Platform | Package | Validated by us | Notes for testers |
|---|---|---|---|
| Windows 10/11 x64 | NSIS installer `Hydra-Setup-<ver>-x64.exe` (per-user, no admin) | Install, launch, uninstall and reinstall on fresh CI runners; daily use on the owner's Windows 11 dev build | Unsigned: SmartScreen shows "Windows protected your PC" → **More info → Run anyway** |
| macOS (Apple silicon) | DMG, arm64 | Install, launch, removal and reinstall on fresh CI runners | Unsigned and not notarized: right-click Hydra.app → **Open**, or `xattr -dr com.apple.quarantine /Applications/Hydra.app`. Intel Macs: no build yet |
| Linux x64 (Debian/Ubuntu) | `.deb` and AppImage | Install, launch, removal and reinstall on fresh CI runners (Ubuntu, Xvfb) | AppImage: `chmod +x` then run. Other distros: AppImage only, untested |
| Phone (any modern browser) | Served by the desktop app on the LAN | Pairing, commands and revocation tested with a scripted client and in a desktop browser; **no physical phone yet** (§7) | Same Wi-Fi as the computer; trusted networks only |

## 3. Install and first run (tester instructions)

1. Install at least one agent CLI and sign in with **your own** account:
   - Claude Code: `npm install -g @anthropic-ai/claude-code`, then run `claude` and sign in.
   - Codex: `npm install -g @openai/codex`, then `codex login`.
2. Install Hydra with the package for your platform (§2).
3. Open Hydra. The **Get started** panel shows whether each CLI is installed and signed in. Press **Re-check** after fixing anything.
4. Add a project: a git repository with at least one commit. Start with a **copy** or a throwaway branch of a real project.
5. Start a task in **Safe** mode. Approve or reject the plan, review the change and checks, then Accept, Request changes or Reject.

### First-run checklist (tester ticks each)
- [ ] Hydra opened without an error dialog
- [ ] Both or one provider shows **Ready**, or the panel told me exactly what to do
- [ ] I added a project
- [ ] A Safe task stopped for plan approval
- [ ] After Accept, the change appeared on my branch, and the checks Hydra ran are listed
- [ ] Roll back restored the previous state
- [ ] Settings → Export as JSON created a file
- [ ] Quitting Hydra and reopening kept my tasks

## 4. What to test (scenarios)

1. A small bug fix with tests (Safe mode).
2. A multi-file feature (Developer mode) with a budget limit.
3. An "Ask a question" task on an unfamiliar repository.
4. Stop a running task; resume a paused one.
5. Commit something on your branch while a task waits for approval, then accept (Hydra should integrate and ask again).
6. Two tasks on the same project at once.
7. Run out of provider quota or sign out mid-task (Hydra should pause, not fail silently).
8. Optional: pair a phone (§7).

## 5. Known limitations (tell testers up front)

- Installers are **unsigned**; operating systems warn on first launch.
- No auto-update: new builds are new downloads.
- Verification runs your project's own test commands with your user's permissions. Safe mode shows the exact commands before running them.
- On Windows, a process started by your tests that detaches from its parent may survive a canceled run (THREAT_MODEL T16).
- The phone UI is served over plain HTTP on the LAN. Use it only on trusted networks or through a VPN such as Tailscale (T20). No internet relay exists yet.
- Codex does not report prices; Codex usage is limited by tokens, not dollars.
- macOS Intel and Linux distros other than Debian/Ubuntu are untested.

## 6. Reporting

### Bug report template
```
Title:
Hydra version (Settings header):            OS and version:
Provider(s) and CLI versions (Agents & providers page):
Mode (Safe / Developer / Autonomous):       Task kind (change / question):
What I did:
What I expected:
What happened:
Did anything change outside the task worktree? (yes/no/unsure)
Attachments: screenshot; task "Activity" tab text; optional JSON export (remove anything private first)
```

### Weekly feedback form (5 minutes)
1. How many tasks did you run this week? How many did you accept?
2. Did Hydra ever change your branch without your approval? (expected: never)
3. Did you ever lose work? Describe.
4. What took longest or confused you?
5. Would you pay for this? How much per month, and why or why not?
6. 0–10: how likely are you to recommend it to a colleague?

### Security disclosure
Report security issues privately, never in a public issue. **Contact address: to be chosen by the owner before the beta** (a mailbox the owner controls). Include steps to reproduce. We will acknowledge within 3 working days.

### Privacy statement (draft for owner review)
Hydra runs on your computer. Projects, tasks, history and evidence are stored in a local SQLite database in your user profile. Hydra has no telemetry and sends nothing to its developers. Prompts and code go only to the AI providers you select, through their official CLIs and under your own account and their terms. Hydra never reads, stores or transmits your provider credentials. Phone pairing works on your local network with end-to-end encryption; no cloud service is involved. Feedback you send us by email or form is used only to improve Hydra.

## 7. Real-phone validation — BLOCKED (manual checklist)

Status: **BLOCKED.** It needs a physical phone on the same network as the computer and the owner's approval of the Windows firewall prompt for port 47900. It has not been simulated. What has been verified instead: the encrypted protocol with a scripted client (19 tests), and pairing, a phone-driven task and revocation in a desktop browser on localhost.

Checklist for the owner or a tester:
1. [ ] Computer and phone on the same trusted Wi-Fi. Note both IPs.
2. [ ] Hydra → Remote devices → Pair a phone: enter a name, choose scopes (view is always on; control and approve are optional), press **Show pairing code**.
3. [ ] Windows: allow Hydra through the firewall for **Private** networks only when prompted. Record whether a prompt appeared.
4. [ ] Scan the QR code or open the link on the phone (iOS Safari and Android Chrome if possible). Record the browser and OS version.
5. [ ] The check code shown on the phone matches the one on the desktop.
6. [ ] The phone lists projects and tasks; the live status updates when a task changes on the desktop.
7. [ ] With `control`: start an "Ask a question" task from the phone; it appears on the desktop.
8. [ ] With `approve`: approve a plan from the phone; without `approve`, the button is refused.
9. [ ] Lock the phone for 5 minutes, unlock: it reconnects and catches up.
10. [ ] Put the phone on mobile data: it cannot connect (expected without a relay).
11. [ ] Revoke the device on the desktop: the phone disconnects within seconds and cannot reconnect.
12. [ ] Reuse the old pairing link: refused.
13. [ ] Record the results in TEST_EVIDENCE.md with date, devices and any failures.

## 8. Success criteria (to leave beta)

- 0 incidents of Hydra changing a user branch without Accept, and 0 data-loss reports.
- ≥ 80% of testers complete the first-run checklist without help.
- ≥ 70% of accepted tasks needed no manual fix-up after Accept.
- No open High or Critical security issue.
- At least 3 testers say they would pay, with a price point.

## 9. Uninstall and data removal

- Windows: Settings → Apps → Hydra → Uninstall. Data stays in `%LOCALAPPDATA%\Hydra\v2`; delete that folder to remove it.
- macOS: delete Hydra.app. Data: `~/Library/Application Support/Hydra/v2`.
- Linux: `sudo apt remove hydra-desktop` or delete the AppImage. Data: `~/.local/share/hydra/v2` (or `$XDG_DATA_HOME/hydra/v2`).
- Task worktrees live inside the data folder; your repositories keep only what you accepted. Leftover `hydra/*` branches can be deleted with `git branch -D`.
- Disconnecting accounts is done in the provider CLIs, not in Hydra: `claude auth logout` (or `/logout` inside Claude Code), `codex logout`. Hydra stores nothing to revoke.

## 10. Before inviting anyone (owner approvals needed)

- [ ] Approve distributing unsigned builds to named testers (no public release).
- [ ] Choose the security contact mailbox and approve the privacy statement.
- [ ] Choose a licence or beta terms (OWNERSHIP_AND_PROVENANCE §7).
- [ ] Decide on the name (OWNERSHIP_AND_PROVENANCE §8).
- [ ] Choose where testers report bugs: private repository issues, email or a form.
