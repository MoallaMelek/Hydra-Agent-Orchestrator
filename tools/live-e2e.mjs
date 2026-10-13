#!/usr/bin/env node
// Live acceptance: drives the real engine with the locally signed-in Claude Code and
// Codex CLIs against throwaway git fixtures in the OS temp directory. Uses the
// operator's own provider accounts (and their usage). Never touches real projects.
// Usage: node tools/live-e2e.mjs <out.json> [scenario...]   scenarios: node python analyze
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Engine } from '@hydra/engine'

const [, , out = 'live-e2e.json', ...wanted] = process.argv
const scenarios = wanted.length ? wanted : ['node', 'python', 'analyze']

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'hydra-live-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore', windowsHide: true })
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Live Test'); git('config', 'user.email', 'live@example.invalid'); git('config', 'core.autocrlf', 'false')
  for (const [path, body] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body) }
  git('add', '-A'); git('commit', '-qm', 'fixture')
  return root
}

const FIXTURES = {
  node: {
    files: {
      'package.json': JSON.stringify({ name: 'live-fixture', private: true, scripts: { test: 'node --test' } }, null, 2),
      'cart.js': 'function total(items) {\n  // sum of price * qty for each item\n  return items.reduce((sum, item) => sum + item.price, 0)\n}\nmodule.exports = { total }\n',
      'cart.test.js': 'const { test } = require("node:test")\nconst assert = require("node:assert/strict")\nconst { total } = require("./cart.js")\ntest("total multiplies by quantity", () => { assert.equal(total([{ price: 2, qty: 3 }, { price: 5, qty: 1 }]), 11) })\n',
      '.gitignore': 'node_modules/\n'
    },
    prompt: 'The cart total ignores item quantity. Fix total() in cart.js so the existing test passes. Keep the change minimal.',
    assignment: { planner: 'claude', implementer: 'codex', reviewer: 'claude' }
  },
  python: {
    files: {
      'slugify.py': 'def slugify(text):\n    """Lowercase, trim, and join words with single hyphens."""\n    return text.replace(" ", "-")\n',
      'test_slugify.py': 'import unittest\nfrom slugify import slugify\n\nclass T(unittest.TestCase):\n    def test_basic(self):\n        self.assertEqual(slugify("  Hello   World "), "hello-world")\n\nif __name__ == "__main__":\n    unittest.main()\n'
    },
    prompt: 'slugify() must lowercase, trim, and collapse runs of whitespace into single hyphens. Fix it so test_slugify.py passes.',
    assignment: { planner: 'codex', implementer: 'claude', reviewer: 'codex' }
  }
}

const results = []
const save = () => writeFileSync(out, JSON.stringify(results, null, 2))
const dataDir = mkdtempSync(join(tmpdir(), 'hydra-live-data-'))
const engine = await Engine.open({ dataDir })
const providers = engine.registry.status().map((p) => ({ id: p.id, installed: p.installed, version: p.version, authenticated: p.authenticated, authMethod: p.authMethod, problems: p.problems }))
results.push({ providers })
console.log(JSON.stringify(providers))
save()

async function until(id, predicate, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const t = engine.store.getTask(id)
    if (predicate(t)) return t
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout at ${engine.store.getTask(id).stage}/${engine.store.getTask(id).status}`)
}
const settledOrWaiting = (t) => ['waiting_input', 'completed', 'failed', 'canceled'].includes(t.status)

for (const name of scenarios) {
  const started = Date.now()
  const record = { scenario: name }
  results.push(record)
  try {
    if (name === 'analyze') {
      const root = repo(FIXTURES.node.files)
      const project = (await engine.execute({ type: 'project.add', root })).result
      const ack = await engine.execute({ type: 'task.create', projectId: project.id, prompt: 'What does total() in cart.js compute, and does it match its comment? Answer briefly.', intent: 'analyze', mode: 'safe', assignment: { planner: 'codex', implementer: 'codex', reviewer: 'codex' } })
      if (!ack.ok) throw new Error(ack.error.message)
      const t = await until(ack.result.id, settledOrWaiting, 10 * 60_000)
      Object.assign(record, { status: t.status, outcome: t.outcome, error: t.error, answer: t.answer?.slice(0, 600), usage: t.usage, treeClean: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }) === '' })
    } else {
      const fx = FIXTURES[name]
      const root = repo(fx.files)
      const project = (await engine.execute({ type: 'project.add', root })).result
      const ack = await engine.execute({ type: 'task.create', projectId: project.id, prompt: fx.prompt, intent: 'change', mode: 'developer', assignment: fx.assignment })
      if (!ack.ok) throw new Error(ack.error.message)
      const id = ack.result.id
      const t = await until(id, settledOrWaiting, 40 * 60_000)
      const detail = engine.taskDetail(id)
      const originalUntouched = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }) === '' && execFileSync('git', ['log', '--oneline'], { cwd: root, encoding: 'utf8' }).trim().split('\n').length === 1
      Object.assign(record, {
        status: t.status, waitReason: t.waitReason, error: t.error, checks: t.checks.map((c) => c.label),
        stages: t.stages.map((s) => `${s.stage}#${s.attempt}:${s.status}${s.note ? ` (${s.note.slice(0, 160)})` : ''}`),
        plan: t.plan && { steps: t.plan.steps.length, criteria: t.plan.acceptanceCriteria },
        review: t.review && { verdict: t.review.verdict, findings: t.review.findings.map((f) => `${f.severity}: ${f.issue.slice(0, 160)}`) },
        evidence: detail.evidence.map((e) => ({ phase: e.phase, label: e.label, exit: e.exitCode, sha: e.commitSha.slice(0, 10), ms: e.durationMs, spawnError: e.spawnError })),
        demo: t.demo, runs: detail.runs.map((r) => ({ provider: r.provider, role: r.role, stage: r.stage, status: r.status, model: r.model, usage: r.usage, error: r.error })),
        usage: t.usage, userTreeUntouchedBeforeAccept: originalUntouched
      })
      if (t.status === 'waiting_input' && t.waitReason === 'final_approval') {
        const diff = await engine.taskDiff(id)
        record.diff = diff.files.map((f) => ({ path: f.path, status: f.status, add: f.additions, del: f.deletions }))
        const accept = await engine.execute({ type: 'task.decide', taskId: id, decision: 'accept', headSha: t.workspace.headSha })
        const done = await until(id, (x) => x.status !== 'running' && x.status !== 'queued' && x.stage === 'apply' || x.status === 'completed' || x.error, 120_000)
        const testCmd = name === 'node' ? ['node', ['--test']] : ['python', ['-m', 'unittest', '-q']]
        let independentTest
        try { execFileSync(testCmd[0], testCmd[1], { cwd: root, stdio: 'ignore', windowsHide: true }); independentTest = 'pass' } catch { independentTest = 'fail' }
        record.accept = { ok: accept.ok, outcome: done.outcome, applied: done.applied, independentTestAfterApply: independentTest }
        const rollback = await engine.execute({ type: 'task.rollback', taskId: id })
        let afterRollback
        try { execFileSync(testCmd[0], testCmd[1], { cwd: root, stdio: 'ignore', windowsHide: true }); afterRollback = 'pass' } catch { afterRollback = 'fail' }
        record.rollback = { ok: rollback.ok, testAfterRollback: afterRollback, log: execFileSync('git', ['log', '--oneline'], { cwd: root, encoding: 'utf8' }).trim().split('\n') }
      }
    }
  } catch (error) {
    record.error = String(error?.stack ?? error)
  }
  record.ms = Date.now() - started
  save()
  console.log(JSON.stringify({ scenario: name, status: record.status, error: record.error, ms: record.ms }))
}
await engine.close()
