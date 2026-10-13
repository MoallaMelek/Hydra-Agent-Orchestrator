import { realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { parse, relative, resolve, isAbsolute, sep } from 'node:path'
import { invalid } from '../util/errors.js'

const norm = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path)

export function isInside(parent: string, child: string): boolean {
  const rel = relative(norm(parent), norm(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

const SYSTEM_DIRS = process.platform === 'win32'
  ? [process.env.SystemRoot ?? 'C:\\Windows', process.env.ProgramFiles ?? 'C:\\Program Files', process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', process.env.ProgramData ?? 'C:\\ProgramData']
  : ['/bin', '/boot', '/dev', '/etc', '/lib', '/proc', '/sbin', '/sys', '/usr', '/var', '/System', '/Library', '/Applications']

/**
 * Validates and canonicalizes a project root. Refuses filesystem roots, the home
 * directory itself, system directories and Hydra's own data directory, so that a
 * task can never be scoped to "everything".
 */
export function validateProjectRoot(input: string, dataDir: string): string {
  if (!isAbsolute(input)) throw invalid('Project path must be absolute')
  let root: string
  try {
    root = realpathSync.native(resolve(input))
  } catch {
    throw invalid(`Project path does not exist: ${input}`)
  }
  if (!statSync(root).isDirectory()) throw invalid('Project path must be a directory')
  if (parse(root).root.replace(/[\\/]+$/, '') === root.replace(/[\\/]+$/, '')) throw invalid('A filesystem root cannot be a project')
  const home = realpathSync.native(homedir())
  if (norm(root) === norm(home)) throw invalid('Your home directory cannot be a project; choose a project folder inside it')
  for (const dir of SYSTEM_DIRS) {
    if (isInside(dir, root)) throw invalid(`System directory ${dir} cannot be a project`)
  }
  if (isInside(dataDir, root) || isInside(root, dataDir)) throw invalid('A project cannot contain or be inside Hydra\'s data directory')
  return root.endsWith(sep) && root.length > 3 ? root.slice(0, -1) : root
}
