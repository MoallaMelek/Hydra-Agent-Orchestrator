#!/usr/bin/env node
// Prints the build/test/lint commands a project defines. Reads files only; executes nothing.
// Usage: node detect-checks.mjs [project-dir]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.argv[2] ?? '.'
if (!existsSync(root)) {
  console.error(`Not a directory: ${root}`)
  process.exit(2)
}
const has = (...names) => names.some((n) => existsSync(join(root, n)))
const read = (n) => { try { return readFileSync(join(root, n), 'utf8') } catch { return '' } }
const win = process.platform === 'win32'
const checks = []
const add = (ecosystem, kind, command) => checks.push({ ecosystem, kind, command })

const custom = read(join('.hydra', 'checks.json'))
if (custom) {
  for (const c of JSON.parse(custom).checks ?? []) add('custom', c.kind ?? 'test', c.argv.join(' '))
} else {
  if (has('package.json')) {
    const scripts = (() => { try { return JSON.parse(read('package.json')).scripts ?? {} } catch { return {} } })()
    const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb', 'bun.lock') ? 'bun' : 'npm'
    for (const [script, kind] of [['typecheck', 'typecheck'], ['lint', 'lint'], ['build', 'build'], ['test', 'test']]) {
      const body = scripts[script]
      if (typeof body === 'string' && body.trim() && !/no test specified/i.test(body)) add('node', kind, `${pm} run ${script}`)
    }
  }
  const pyproject = read('pyproject.toml')
  const pyTests = (() => { try { return readdirSync(root).some((n) => /^test_.*\.py$|_test\.py$/.test(n)) } catch { return false } })()
  if (has('pyproject.toml', 'setup.py', 'setup.cfg', 'pytest.ini', 'tox.ini', 'conftest.py', 'requirements.txt') || pyTests) {
    const venv = ['.venv', 'venv'].map((v) => join(root, v, win ? 'Scripts/python.exe' : 'bin/python')).find((p) => existsSync(p))
    const py = venv ?? (win ? 'python' : 'python3')
    const pytest = has('pytest.ini', 'conftest.py') || /pytest/i.test(pyproject + read('requirements.txt') + read('requirements-dev.txt') + read('setup.cfg'))
    if (/\[tool\.mypy/.test(pyproject) || has('mypy.ini')) add('python', 'typecheck', `${py} -m mypy .`)
    if (/\[tool\.ruff/.test(pyproject) || has('ruff.toml', '.ruff.toml')) add('python', 'lint', `${py} -m ruff check .`)
    add('python', 'test', pytest ? `${py} -m pytest -q` : `${py} -m unittest discover -q`)
  }
  if (has('go.mod')) { add('go', 'build', 'go build ./...'); add('go', 'lint', 'go vet ./...'); add('go', 'test', 'go test ./...') }
  if (has('Cargo.toml')) { add('rust', 'build', 'cargo build'); add('rust', 'test', 'cargo test') }
  if (has('pom.xml')) add('java', 'test', `${has(win ? 'mvnw.cmd' : 'mvnw') ? (win ? '.\\mvnw.cmd' : './mvnw') : 'mvn'} -B test`)
  else if (has('build.gradle', 'build.gradle.kts')) add('java', 'test', `${has(win ? 'gradlew.bat' : 'gradlew') ? (win ? '.\\gradlew.bat' : './gradlew') : 'gradle'} test`)
  if (has('CMakeLists.txt')) { add('cpp', 'build', 'cmake -S . -B build-verify && cmake --build build-verify'); add('cpp', 'test', 'ctest --test-dir build-verify --output-on-failure') }
  else if (/^test\s*:/m.test(read('Makefile'))) add('cpp', 'test', 'make test')
}

if (!checks.length) {
  console.log('No checks detected. Ask the user which commands verify this project, or add .hydra/checks.json.')
} else {
  for (const c of checks) console.log(`[${c.ecosystem}/${c.kind}] ${c.command}`)
}
