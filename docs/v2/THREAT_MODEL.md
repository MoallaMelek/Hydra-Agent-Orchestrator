# Threat model — Hydra v2

Assets: user source code and git history; credentials on the machine (provider logins, SSH keys, cloud tokens); API spend; the user's machine; remote-session integrity.

Actors: (A1) malicious or poisoned repository content (prompt injection via README, issues, test files); (A2) a misbehaving or compromised AI agent; (A3) another local process or user on the same machine; (A4) a network attacker between phone, relay and desktop; (A5) the relay operator; (A6) a holder of a stolen phone or pairing QR; (A7) a malicious web page in the user's browser (DNS rebinding or CSRF against the local API); (A8) a supply-chain compromise of dependencies.

Enforcement labels: **[OS]** enforced by the operating system or sandbox · **[CLI]** enforced by the provider CLI's permission system · **[ENGINE]** enforced by Hydra code · **[PROMPT]** an instruction only (not a security control).

| # | Threat | Control | Label | Residual risk |
|---|---|---|---|---|
| T1 | Agent edits files outside the task | Worktree is the agent cwd; Claude `--restricted` confines file tools to working dirs; Codex `workspace-write` sandbox | [CLI] Claude, [OS] Codex (macOS/Linux; Windows per Codex sandbox) | A Claude CLI bug could escape confinement; the worktree still bounds what gets *applied* |
| T2 | Agent runs arbitrary shell or exfiltrates over the network | Claude: no shell tools (`--tools` allowlist, `--restricted`). Codex: sandbox with network disabled, `approval_policy=never` | [CLI]/[OS] | Codex sandbox strength varies by OS |
| T3 | Agent changes reach the user's repo unreviewed | Apply only on a human Accept of an exact SHA; never auto-apply in any mode | [ENGINE] | User approves without reading |
| T4 | Prompt injection makes Hydra run attacker commands | The engine executes only detector-derived or user-approved checks, never agent-proposed commands; repository text is passed as quoted data | [ENGINE] | Project test scripts are themselves code from the repo (A1) |
| T5 | Verification runs malicious test code | Safe mode requires approval of checks; scrubbed env (no tokens); timeouts; optional `container` profile with `--network none` | [ENGINE]/[OS when container] | Host profile runs with user privileges, so only verify repositories you trust |
| T6 | Fake "tests passed" | Evidence is collected by the engine from the real process exit code at a recorded SHA | [ENGINE] | — |
| T7 | Runaway spend or loops | Per-task budgets (cost, tokens, time, runs, fix rounds) checked before and during runs; Claude `--max-budget-usd` | [ENGINE]/[CLI] | Codex cost is estimated from token usage |
| T8 | Local API abuse (A3, A7) | 127.0.0.1 bind, 256-bit bearer token, Host and Origin allowlist, no cookies, request size limits, zod validation | [ENGINE] | A same-user process can read the token from the shell's memory or the data dir |
| T9 | Remote eavesdropping or tampering (A4, A5) | End-to-end encryption (X25519 + XChaCha20-Poly1305), per-frame counters, device static keys, transcript-bound handshake | [ENGINE] | Metadata (timing, sizes) visible to the relay |
| T10 | Stolen phone or QR (A6) | Single-use 5-minute pairing secret; device expiry; revocation from the desktop; scoped permissions (`approve` opt-in) | [ENGINE] | An unlocked phone with an active session can act until revoked |
| T11 | Relay abuse or DoS | Per-IP and per-room rate limits, frame size cap, room auth token for the engine side | [ENGINE] | Public relay availability depends on the hosting |
| T12 | Secrets in context sent to providers | Context builder excludes `.env*`, keys and credential files; transcripts stored locally only | [ENGINE] | Agents may still read secrets inside the worktree via Read tools; do not keep secrets in repos |
| T13 | Supply chain (A8) | Pinned lockfile, `npm audit` gate in CI, minimal dependencies, no runtime `npx`/remote code | [ENGINE] | Transitive compromise before advisories exist |
| T14 | Update tampering | Updates only from signed releases (signing pending owner certificates) | — | Unsigned builds until the owner obtains certificates |
| T15 | Electron renderer compromise | `contextIsolation`, `sandbox`, no `nodeIntegration`, minimal preload, navigation and window-open blocking, CSP | [ENGINE] | — |
| T16 | Orphaned agent/check descendants on Windows after their parent exits | POSIX: process-group kill after every run; Windows: `taskkill /T` while the parent lives, plus PID-verified orphan kill at recovery | [ENGINE] | Descendants detached from an already-exited parent on Windows may survive (needs Job Objects) |
| T17 | Git filters (clean/smudge) from user config execute during engine checkouts | Hooks disabled; `--no-ext-diff --no-textconv` for diffs | [ENGINE] | Filters configured in the user's git config still run |
| T18 | Tampered worktree git metadata redirects engine commits | Pinned `--git-dir/--work-tree`; `.git` pointer and HEAD verified before every write | [ENGINE] | — |
| T19 | Stale or replayed approval applies an unreviewed revision | Accept carries the reviewed SHA; mismatch is refused; moved target triggers integrate + re-verify + fresh approval | [ENGINE] | — |
| T20 | Phone UI served over plain HTTP on the LAN can be modified by an active LAN attacker before it runs | Channel crypto protects traffic; device keys never leave the phone; revocation; short pairing window; strict CSP | [ENGINE] | Code delivery integrity on hostile LANs: use a trusted network or VPN (Tailscale) until an HTTPS relay exists |
