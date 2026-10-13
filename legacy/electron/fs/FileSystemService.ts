import { readdir, readFile, writeFile, stat, realpath } from 'fs/promises'
import { watch, type FSWatcher } from 'fs'
import { join, relative, basename } from 'path'

import type { FsDirEntry, FsReadFileResult, FsSearchResult, FsWatchEventPayload } from '@shared/types'
import {
  isPathContained,
  resolveContainedExistingPath,
  resolveContainedWritePath
} from '../security/pathPolicy'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB

const IGNORED_NAMES = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  'dist',
  'build',
  'out',
  '.cache',
  '.turbo',
  '.vercel',
  '.svelte-kit',
  '__pycache__',
  '.DS_Store',
  'Thumbs.db',
  'coverage',
  '.nyc_output',
  '.parcel-cache'
])

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.avif',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.avi', '.mov',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.exe', '.dll', '.so', '.dylib',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.sqlite', '.db'
])

function isBinaryFile(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return false
  return BINARY_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

export class FileSystemService {
  private watchers = new Map<string, FSWatcher>()

  async readDir(dirPath: string, projectDir: string): Promise<FsDirEntry[]> {
    const { root, path: fullPath } = await resolveContainedExistingPath(projectDir, dirPath)

    const names = await readdir(fullPath)
    const result: FsDirEntry[] = []

    for (const name of names) {
      if (IGNORED_NAMES.has(name)) continue
      if (name.startsWith('.') && name !== '.env.example') continue
      const childPath = join(fullPath, name)
      const canonicalChild = await realpath(childPath).catch(() => null)
      if (!canonicalChild || !isPathContained(root, canonicalChild)) continue
      const info = await stat(canonicalChild).catch(() => null)
      if (!info) continue
      if (info.isFile() || info.isDirectory()) {
        result.push({ name, isDirectory: info.isDirectory() })
      }
    }

    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })

    return result
  }

  async readFile(filePath: string, projectDir: string): Promise<FsReadFileResult> {
    const { path: fullPath } = await resolveContainedExistingPath(projectDir, filePath)

    if (isBinaryFile(basename(fullPath))) {
      throw new Error('Cannot open binary files')
    }

    const stats = await stat(fullPath)
    if (stats.size > MAX_FILE_SIZE) {
      throw new Error(`File too large (${(stats.size / 1024 / 1024).toFixed(1)} MB, max 5 MB)`)
    }

    const content = await readFile(fullPath, 'utf-8')
    return { content, path: filePath }
  }

  async writeFile(filePath: string, content: string, projectDir: string): Promise<void> {
    const { path: fullPath } = await resolveContainedWritePath(projectDir, filePath)
    await writeFile(fullPath, content, 'utf-8')
  }

  async searchFiles(
    query: string,
    projectDir: string,
    maxResults = 100
  ): Promise<FsSearchResult[]> {
    if (!query.trim()) return []
    const lowerQuery = query.toLowerCase()
    const results: FsSearchResult[] = []

    const { root } = await resolveContainedExistingPath(projectDir, '.')
    const visited = new Set<string>()
    const walk = async (dir: string): Promise<void> => {
      if (results.length >= maxResults) return
      const canonicalDir = await realpath(dir).catch(() => null)
      if (!canonicalDir || !isPathContained(root, canonicalDir) || visited.has(canonicalDir)) return
      visited.add(canonicalDir)
      let names: string[]
      try {
        names = await readdir(canonicalDir)
      } catch {
        return
      }
      for (const name of names) {
        if (results.length >= maxResults) return
        if (IGNORED_NAMES.has(name)) continue
        if (name.startsWith('.')) continue
        const fullPath = join(canonicalDir, name)
        const canonicalPath = await realpath(fullPath).catch(() => null)
        if (!canonicalPath || !isPathContained(root, canonicalPath)) continue
        const relPath = relative(root, canonicalPath).replaceAll('\\', '/')
        const info = await stat(canonicalPath).catch(() => null)
        if (!info) continue
        if (info.isDirectory()) {
          await walk(canonicalPath)
        } else if (!isBinaryFile(name)) {
          if (relPath.toLowerCase().includes(lowerQuery)) {
            results.push({ path: relPath, name, isDirectory: false })
          }
        }
      }
    }

    await walk(projectDir)
    return results
  }

  startWatch(
    agentId: string,
    projectDir: string,
    onEvent: (payload: FsWatchEventPayload) => void
  ): void {
    this.stopWatch(agentId)

    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const watcher = watch(projectDir, { recursive: true }, (eventType, filename) => {
      // macOS FSEvents sometimes delivers `filename === null` (notably when a
      // top-level directory is created). Treat as a generic refresh of the root
      // rather than dropping the event.
      const name = filename ?? ''

      if (name) {
        // Ignore changes in filtered directories (only when we know the path).
        const parts = name.split('/')
        if (parts.some((p) => IGNORED_NAMES.has(p))) return
      }

      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        onEvent({
          agentId,
          eventType: eventType === 'rename' ? 'rename' : 'change',
          path: name
        })
      }, 300)
    })

    this.watchers.set(agentId, watcher)
  }

  stopWatch(agentId: string): void {
    const existing = this.watchers.get(agentId)
    if (existing) {
      existing.close()
      this.watchers.delete(agentId)
    }
  }

  stopAll(): void {
    for (const [id] of this.watchers) {
      this.stopWatch(id)
    }
  }
}
