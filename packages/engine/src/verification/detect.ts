import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { CheckKind, type CheckSpec, type Ecosystem } from '@hydra/protocol'

/** `{scratch}` in an argv is replaced at run time with a per-run directory outside the worktree. */
export const SCRATCH = '{scratch}'

const has = (root: string, ...names: string[]) => names.some((name) => existsSync(join(root, name)))
const read = (root: string, name: string): string | null => {
  try { return readFileSync(join(root, name), 'utf8') } catch { return null }
}
const IS_WIN = process.platform === 'win32'

function spec(ecosystem: Ecosystem, kind: CheckSpec['kind'], label: string, argv: string[], timeoutSec = 600, required = true): CheckSpec {
  return { id: `${ecosystem}:${kind}:${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`, ecosystem, kind, label, argv, cwd: '.', timeoutSec, required }
}

// ── Node.js / TypeScript ─────────────────────────────────────────
const PLACEHOLDER_TEST = /no test specified/i

function detectNode(root: string): CheckSpec[] {
  const raw = read(root, 'package.json')
  if (!raw) return []
  let scripts: Record<string, unknown>
  try { scripts = (JSON.parse(raw) as { scripts?: Record<string, unknown> }).scripts ?? {} } catch { return [] }
  const pm = has(root, 'pnpm-lock.yaml') ? 'pnpm' : has(root, 'yarn.lock') ? 'yarn' : has(root, 'bun.lockb', 'bun.lock') ? 'bun' : 'npm'
  const run = (script: string) => (pm === 'yarn' ? [pm, 'run', script] : [pm, 'run', script])
  const out: CheckSpec[] = []
  const order: Array<[string, CheckSpec['kind'], boolean]> = [['typecheck', 'typecheck', true], ['lint', 'lint', false], ['build', 'build', true], ['test', 'test', true]]
  for (const [script, kind, required] of order) {
    const body = scripts[script]
    if (typeof body !== 'string' || !body.trim()) continue
    if (script === 'test' && PLACEHOLDER_TEST.test(body)) continue
    out.push(spec('node', kind, `${pm} run ${script}`, run(script), 900, required))
  }
  return out
}

// ── Python ───────────────────────────────────────────────────────
function pythonFor(root: string): string {
  for (const venv of ['.venv', 'venv']) {
    const candidate = IS_WIN ? join(root, venv, 'Scripts', 'python.exe') : join(root, venv, 'bin', 'python')
    if (existsSync(candidate)) return candidate
  }
  return IS_WIN ? 'python' : 'python3'
}

function detectPython(root: string): CheckSpec[] {
  const pyproject = read(root, 'pyproject.toml') ?? ''
  const setupCfg = read(root, 'setup.cfg') ?? ''
  const signals = has(root, 'pyproject.toml', 'setup.py', 'setup.cfg', 'pytest.ini', 'tox.ini', 'conftest.py', 'requirements.txt')
  const looseTests = (() => { try { return readdirSync(root).some((n) => /^test_.*\.py$|_test\.py$/.test(n)) } catch { return false } })()
  if (!signals && !looseTests && !has(root, 'tests')) return []
  const python = pythonFor(root)
  const usesPytest = has(root, 'pytest.ini', 'conftest.py') || /pytest/i.test(pyproject) || /pytest/i.test(setupCfg) || /pytest/i.test(read(root, 'requirements.txt') ?? '') || /pytest/i.test(read(root, 'requirements-dev.txt') ?? '')
  const out = [usesPytest
    ? spec('python', 'test', 'pytest', [python, '-m', 'pytest', '-q', '-p', 'no:cacheprovider'])
    : spec('python', 'test', 'unittest', [python, '-m', 'unittest', 'discover', '-q'])]
  if (/\[tool\.ruff/.test(pyproject) || has(root, 'ruff.toml', '.ruff.toml')) out.unshift(spec('python', 'lint', 'ruff', [python, '-m', 'ruff', 'check', '.'], 300, false))
  if (/\[tool\.mypy/.test(pyproject) || has(root, 'mypy.ini')) out.unshift(spec('python', 'typecheck', 'mypy', [python, '-m', 'mypy', '.'], 600, true))
  return out
}

// ── Go / Rust / Java / C++ ───────────────────────────────────────
function detectGo(root: string): CheckSpec[] {
  if (!has(root, 'go.mod')) return []
  return [spec('go', 'build', 'go build', ['go', 'build', './...']), spec('go', 'lint', 'go vet', ['go', 'vet', './...'], 600, false), spec('go', 'test', 'go test', ['go', 'test', './...'])]
}

function detectRust(root: string): CheckSpec[] {
  if (!has(root, 'Cargo.toml')) return []
  return [spec('rust', 'build', 'cargo build', ['cargo', 'build', '--quiet'], 1800), spec('rust', 'test', 'cargo test', ['cargo', 'test', '--quiet'], 1800)]
}

function detectJava(root: string): CheckSpec[] {
  if (has(root, 'pom.xml')) {
    // Keep an explicit "./" so the runner executes the project wrapper instead of searching PATH.
    const mvn = has(root, IS_WIN ? 'mvnw.cmd' : 'mvnw') ? (IS_WIN ? './mvnw.cmd' : './mvnw') : 'mvn'
    return [spec('java', 'test', 'maven test', [mvn, '-B', '-q', 'test'], 1800)]
  }
  if (has(root, 'build.gradle', 'build.gradle.kts')) {
    const gradle = has(root, IS_WIN ? 'gradlew.bat' : 'gradlew') ? (IS_WIN ? './gradlew.bat' : './gradlew') : 'gradle'
    return [spec('java', 'test', 'gradle test', [gradle, 'test', '--console=plain'], 1800)]
  }
  return []
}

function detectCpp(root: string): CheckSpec[] {
  if (has(root, 'CMakeLists.txt')) {
    const build = `${SCRATCH}/cmake-build`
    return [
      spec('cpp', 'build', 'cmake configure', ['cmake', '-S', '.', '-B', build], 900),
      spec('cpp', 'build', 'cmake build', ['cmake', '--build', build], 1800),
      spec('cpp', 'test', 'ctest', ['ctest', '--test-dir', build, '--output-on-failure'], 1800)
    ]
  }
  const makefile = read(root, 'Makefile') ?? read(root, 'makefile')
  if (makefile && /^test\s*:/m.test(makefile)) return [spec('cpp', 'test', 'make test', ['make', 'test'], 1800)]
  return []
}

// ── Project-declared checks (.hydra/checks.json) ─────────────────
const CustomChecks = z.object({
  checks: z.array(z.object({
    label: z.string().min(1).max(200),
    kind: CheckKind,
    argv: z.array(z.string().min(1).max(1000)).min(1).max(64),
    cwd: z.string().max(500).default('.'),
    timeoutSec: z.number().int().positive().max(3600).default(900),
    required: z.boolean().default(true)
  })).min(1).max(30)
})

export function detectCustom(root: string): CheckSpec[] | null {
  const raw = read(root, join('.hydra', 'checks.json'))
  if (raw === null) return null
  const parsed = CustomChecks.parse(JSON.parse(raw))
  return parsed.checks.map((c, index) => ({ ...spec('custom', c.kind, c.label, c.argv, c.timeoutSec, c.required), id: `custom:${index}`, cwd: c.cwd }))
}

/**
 * Detects the checks Hydra will run itself. A `.hydra/checks.json` in the project
 * replaces auto-detection entirely. Detection reads files only; it executes nothing.
 */
export function detectChecks(root: string): CheckSpec[] {
  const custom = detectCustom(root)
  if (custom) return custom
  return [...detectNode(root), ...detectPython(root), ...detectGo(root), ...detectRust(root), ...detectJava(root), ...detectCpp(root)]
}

/** Dependency directories linked from the project into a worktree (never committed). */
export function dependencyLinks(root: string): string[] {
  return ['node_modules'].filter((name) => existsSync(join(root, name)))
}

/** Files whose content decides what a check actually executes. */
const DEFINITION_FILES = [
  join('.hydra', 'checks.json'), 'pyproject.toml', 'setup.cfg', 'setup.py', 'pytest.ini', 'tox.ini', 'conftest.py', 'requirements.txt',
  'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'CMakeLists.txt', 'Makefile', 'makefile',
  // Detection chooses the executable from these files, not just package scripts.
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', 'requirements-dev.txt'
]

/**
 * Digest of everything that defines the checks: package.json scripts and the build
 * files above. If an agent edits them after approval, the digest changes.
 */
export function checkDefinitionDigest(root: string): string {
  const hash = createHash('sha256')
  const pkg = read(root, 'package.json')
  if (pkg) {
    try { hash.update(JSON.stringify((JSON.parse(pkg) as { scripts?: unknown }).scripts ?? {})) } catch { hash.update(pkg) }
  }
  for (const file of DEFINITION_FILES) {
    let body: Buffer | null = null
    try { body = readFileSync(join(root, file)) } catch { /* missing definition */ }
    hash.update(JSON.stringify([file, body?.toString('base64') ?? null]))
  }
  return hash.digest('hex')
}
