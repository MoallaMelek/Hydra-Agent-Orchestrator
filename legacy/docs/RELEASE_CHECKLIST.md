# Hydra release checklist

- [ ] Verify Claude Code and Codex CLI detection on supported operating systems.
- [ ] Confirm failed authentication produces a recoverable user-facing error.
- [ ] Check session resume and terminal cleanup after process exit.
- [ ] Confirm remote-control access requires the intended authorization.
- [ ] Exercise headless orchestration with a deliberately failing agent.
- [ ] Check that secrets and tokens are absent from logs and release artifacts.
- [ ] Document tested versions and platform-specific limitations.

Do not mark a release ready based only on a successful local startup.
