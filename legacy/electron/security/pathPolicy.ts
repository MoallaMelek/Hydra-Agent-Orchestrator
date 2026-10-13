import { lstat, realpath } from 'fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'path'

function normalizeForComparison(value: string): string {
  return process.platform === 'win32' ? value.toLowerCase() : value
}

export function isPathContained(rootPath: string, candidatePath: string): boolean {
  const root = normalizeForComparison(resolve(rootPath))
  const candidate = normalizeForComparison(resolve(candidatePath))
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export async function canonicalProjectRoot(projectDir: string): Promise<string> {
  const root = await realpath(resolve(projectDir))
  const info = await lstat(root)
  if (!info.isDirectory()) throw new Error('Project root must be a directory')
  return root
}

export async function resolveContainedExistingPath(
  projectDir: string,
  requestedPath: string
): Promise<{ root: string; path: string }> {
  const root = await canonicalProjectRoot(projectDir)
  const lexicalCandidate = resolve(projectDir, requestedPath)
  if (!isPathContained(resolve(projectDir), lexicalCandidate)) {
    throw new Error('Path traversal denied')
  }

  const canonicalCandidate = await realpath(lexicalCandidate)
  if (!isPathContained(root, canonicalCandidate)) {
    throw new Error('Path traversal denied: symbolic link leaves project')
  }
  return { root, path: canonicalCandidate }
}

export async function resolveContainedWritePath(
  projectDir: string,
  requestedPath: string
): Promise<{ root: string; path: string }> {
  const root = await canonicalProjectRoot(projectDir)
  const lexicalCandidate = resolve(projectDir, requestedPath)
  if (!isPathContained(resolve(projectDir), lexicalCandidate)) {
    throw new Error('Path traversal denied')
  }

  const parent = await realpath(dirname(lexicalCandidate))
  if (!isPathContained(root, parent)) {
    throw new Error('Path traversal denied: symbolic link leaves project')
  }

  const targetInfo = await lstat(lexicalCandidate).catch(() => null)
  if (targetInfo?.isSymbolicLink()) {
    throw new Error('Writing through symbolic links is denied')
  }

  const canonicalCandidate = targetInfo
    ? await realpath(lexicalCandidate)
    : resolve(parent, basename(lexicalCandidate))
  if (!isPathContained(root, canonicalCandidate)) {
    throw new Error('Path traversal denied')
  }
  return { root, path: canonicalCandidate }
}
