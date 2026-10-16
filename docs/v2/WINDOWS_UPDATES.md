# Windows updates: implementation and release gate

The installed executable inspected on 16 October 2026 reports **2.0.0-alpha.0**, is unsigned, and contains no `resources/app-update.yml`. Its shell predates the desktop install bridge. Its existing engine has a signed-manifest check/download foundation, but no complete installer/restart experience. It cannot acquire the new updater by clicking a control it does not contain.

## Smallest one-time migration

1. Provision the publisher Ed25519 release key outside the repository and a Windows Authenticode certificate. No key or certificate was created by this task. Put the public key in `HYDRA_UPDATE_KEY`; protect the private signing key and certificate using the repository's release environment. Never paste private material into a chat or commit it.
2. Build one reviewed, signed update-capable v2 NSIS installer with the existing identity `dev.melekmoalla.hydra`, product name Hydra, per-user installation and unchanged engine data layout. Use a version newer than the installed alpha. Do not install the old 0.2 application over v2.
3. Close active work, back up the current SQLite database and retain a trusted previous installer. Install over the existing **same** v2 installation; do not uninstall or delete app data. Provider credentials remain owned by the provider CLIs and are not migrated through Hydra.
4. Complete the disposable-data upgrade and failure matrix below before offering the release to users. One manual migration is needed for the presently installed shell. Ordinary later updates are then downloaded and installed through Settings → Updates.

## Trust and lifecycle

The desktop build embeds only the publisher public key and a fixed HTTPS release address under the existing Hydra GitHub repository. Stable and preview builds use separate channel-manifest assets, `updates-stable/hydra-update-stable.json` and `updates-preview/hydra-update-preview.json`. The selected build channel cannot silently switch. Downgrades and mismatched platforms are refused. Numeric prerelease identifiers follow version ordering (`alpha.10` > `alpha.2`).

Every manifest is Ed25519 verified. Every installer is matched to its signed size and SHA-256; bytes are checked again immediately before handoff and by the Windows helper. Redirects remain HTTPS and are bounded. Manifest size, header waits and stream stalls are bounded. Partial/failed/canceled downloads are discarded; progress is actual transferred bytes and is throttled.

Automatic checks start after a 30-second delay and recur every six hours in configured packaged Windows builds only. Background download is optional and off by default. Installation is never automatic on quit. “Restart to Update” first locks editing, flushes persisted drafts and refuses unsent messages/feedback or marked unsaved inputs. An engine maintenance lease prevents new task/check/remote mutations, shuts down idle prewarmed agents, and creates a SQLite backup. Leases expire after a lost preparation response. The lease is confirmed before handoff. The helper is armed only after confirmed engine exit, then waits for the desktop process to exit, rechecks the installer and runs NSIS. It records failure/exit/restart phases. The helper receives a minimal OS environment, no provider API credentials, and uses the OS PowerShell by absolute path with no profile or execution-policy bypass.

Failed installation attempts retain a handoff journal and backup path. The old executable is relaunched when possible. This is **not a demonstrated automatic rollback**: a partially applied installer and a database schema migration require the retained trusted installer and matching backup. Do not automatically copy an old database over new data or downgrade a running application.

## Controlled GitHub workflow

`.github/workflows/windows-updates.yml` runs on explicit owner dispatch, validates an existing version tag/commit, checks the code, embeds the reviewed public configuration, requires Windows code signing, computes and signs metadata from the actual artifact, and uploads workflow artifacts. Optional staging creates a **draft** GitHub release. It does not publish the release, change secrets, or move the stable/preview channel tags.

The owner must configure `windows-updates` with required reviewers before use, and provision `HYDRA_UPDATE_KEY`, `HYDRA_UPDATE_SIGNING_KEY`, `WINDOWS_CSC_LINK`, and `WINDOWS_CSC_KEY_PASSWORD` through appropriate public-variable/secret scopes. Private signing material is available only to signing steps. Pinned Action revisions were verified against their official upstream tags. No workflow was dispatched in this task.

## Acceptance matrix still required before publication

| Scenario | Required evidence | This task |
|---|---|---|
| v1 installed → signed v2 appears → click download → restart → v2 launches | Actual isolated Windows NSIS installation, version and health check | **UNVERIFIED / release provisioning blocked** |
| Projects/settings/history survive | Compare known disposable records before and after actual installer run | Controller/native restart tests passed; **installer survival unverified** |
| Credentials/accounts survive | OS/provider sign-in remains valid; no credential copying | Credentials untouched; **post-installer sign-in unverified** |
| Interrupted/corrupt/untrusted download | No installer execution; retry succeeds | Signature/hash/stream-stall, partial-byte cancellation/cleanup/retry and transport tests; cancellation UI and real release-server interruption remain unverified |
| Active agent, check or unsent draft | Restart refused, work continues | Automated engine/controller/native draft tests |
| Lost preparation response | Engine lease expires; UI unlocks | Controller tests and expiring engine barrier; no fault-injected HTTP integration |
| Failed installer or restart | Actual NSIS exit, journal, old binary/backup recovery | Helper syntax/controller tests; **real failure recovery unverified** |
| Downgrade, wrong channel or architecture | Package rejected | Automated version/channel/platform tests |
| macOS/Linux | Platform-native update strategy | Existing native shell retained; Windows installation feature only, **not validated on Mac/Linux** |

No release was published and the installed Hydra executable was not replaced. Production update acceptance remains open.
