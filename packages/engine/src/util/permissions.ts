import { chmodSync, existsSync } from 'node:fs'

/**
 * Restricts a path to the current user on macOS and Linux (0700 for directories,
 * 0600 for files). On Windows the per-user profile ACL already does this.
 * Best effort: a filesystem without POSIX modes must not stop the engine.
 */
export function ownerOnly(path: string, mode: 0o700 | 0o600): void {
  if (process.platform === 'win32' || !existsSync(path)) return
  try { chmodSync(path, mode) } catch { /* e.g. FAT or network volumes */ }
}
