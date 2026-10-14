#!/usr/bin/env node
/**
 * Realistic engineering tasks with the real Claude Code and Codex CLIs, against
 * disposable repositories in the OS temp directory. Uses the operator's own accounts.
 * For each scenario it records the plan, stages, evidence, review, cost and time; it
 * then accepts, re-runs the project's tests independently of Hydra, and (for one
 * scenario) rolls back.
 *
 *   npx tsc -b && node tools/live-scenarios.mjs <out.json> [scenario...]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Engine } from '@hydra/engine'

const [, , out = 'live-scenarios.json', ...wanted] = process.argv

function repo(files) {
  const root = mkdtempSync(join(tmpdir(), 'hydra-scn-'))
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'ignore', windowsHide: true })
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Scenario'); git('config', 'user.email', 's@example.invalid'); git('config', 'core.autocrlf', 'false')
  for (const [path, body] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body) }
  git('add', '-A'); git('commit', '-qm', 'fixture')
  return root
}
const run = (cmd, args, cwd) => { try { execFileSync(cmd, args, { cwd, stdio: 'pipe', windowsHide: true }); return 'pass' } catch { return 'fail' } }
const NODE_PKG = (name) => JSON.stringify({ name, private: true, scripts: { test: 'node --test' } }, null, 2)

const SCENARIOS = {
  'refactor-multi-file': {
    assignment: { planner: 'claude', implementer: 'codex', reviewer: 'claude' },
    prompt: 'orders.js and invoice.js both contain their own copy of the price formatting code. Extract it into a new module src/money.js, use it from both files, and keep every test passing.',
    files: {
      'package.json': NODE_PKG('shop'),
      'src/orders.js': "function formatPrice(cents) {\n  const sign = cents < 0 ? '-' : ''\n  const abs = Math.abs(cents)\n  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`\n}\nfunction orderLine(item) {\n  return `${item.qty} x ${item.name} @ ${formatPrice(item.cents)}`\n}\nmodule.exports = { orderLine }\n",
      'src/invoice.js': "function formatMoney(cents) {\n  const sign = cents < 0 ? '-' : ''\n  const abs = Math.abs(cents)\n  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`\n}\nfunction invoiceTotal(items) {\n  return formatMoney(items.reduce((s, i) => s + i.qty * i.cents, 0))\n}\nmodule.exports = { invoiceTotal }\n",
      'test/orders.test.js': "const { test } = require('node:test')\nconst assert = require('node:assert/strict')\nconst { orderLine } = require('../src/orders.js')\ntest('order line', () => assert.equal(orderLine({ qty: 2, name: 'pen', cents: 1999 }), '2 x pen @ $19.99'))\n",
      'test/invoice.test.js': "const { test } = require('node:test')\nconst assert = require('node:assert/strict')\nconst { invoiceTotal } = require('../src/invoice.js')\ntest('invoice total', () => assert.equal(invoiceTotal([{ qty: 2, cents: 150 }, { qty: 1, cents: -5 }]), '$2.95'))\n"
    },
    verify: (root) => ({ testsAfterApply: run('node', ['--test'], root), moneyModule: existsSync(join(root, 'src/money.js')), duplicationRemoved: !readFileSync(join(root, 'src/invoice.js'), 'utf8').includes('padStart') }),
    rollback: true
  },
  'feature-python': {
    assignment: { planner: 'claude', implementer: 'claude', reviewer: 'claude' },
    prompt: 'Add a low_stock(threshold) method to Inventory that returns the names of items whose quantity is below the threshold, sorted alphabetically. Add tests for it.',
    files: {
      'inventory.py': 'class Inventory:\n    def __init__(self):\n        self._items = {}\n\n    def add(self, name, qty):\n        self._items[name] = self._items.get(name, 0) + qty\n\n    def remove(self, name, qty):\n        if self._items.get(name, 0) < qty:\n            raise ValueError("not enough " + name)\n        self._items[name] -= qty\n',
      'test_inventory.py': 'import unittest\nfrom inventory import Inventory\n\nclass T(unittest.TestCase):\n    def test_add_remove(self):\n        inv = Inventory()\n        inv.add("pen", 3)\n        inv.remove("pen", 1)\n        self.assertEqual(inv._items["pen"], 2)\n\nif __name__ == "__main__":\n    unittest.main()\n'
    },
    verify: (root) => ({ testsAfterApply: run('python', ['-m', 'unittest', '-q'], root), hasMethod: readFileSync(join(root, 'inventory.py'), 'utf8').includes('def low_stock') })
  },
  'mixed-language': {
    assignment: { planner: 'claude', implementer: 'codex', reviewer: 'claude' },
    prompt: 'The JavaScript tax calculator disagrees with the Python reference for amounts over 1000. Make the JavaScript version match the Python one; do not change the Python code.',
    files: {
      'package.json': NODE_PKG('tax'),
      'tax.py': 'def tax(amount):\n    # 10% up to 1000, 20% on the part above 1000\n    if amount <= 1000:\n        return round(amount * 0.10, 2)\n    return round(100 + (amount - 1000) * 0.20, 2)\n',
      'test_tax.py': 'import unittest\nfrom tax import tax\n\nclass T(unittest.TestCase):\n    def test_tax(self):\n        self.assertEqual(tax(500), 50)\n        self.assertEqual(tax(1500), 200)\n\nif __name__ == "__main__":\n    unittest.main()\n',
      'tax.js': 'function tax(amount) {\n  // should match tax.py\n  return Math.round(amount * 0.1 * 100) / 100\n}\nmodule.exports = { tax }\n',
      'tax.test.js': "const { test } = require('node:test')\nconst assert = require('node:assert/strict')\nconst { tax } = require('./tax.js')\ntest('matches python', () => { assert.equal(tax(500), 50); assert.equal(tax(1500), 200) })\n"
    },
    verify: (root) => ({ jsAfterApply: run('node', ['--test'], root), pyAfterApply: run('python', ['-m', 'unittest', '-q'], root), pythonUntouched: readFileSync(join(root, 'tax.py'), 'utf8').includes('# 10% up to 1000') })
  },
  'missing-dependency': {
    assignment: { planner: 'claude', implementer: 'claude', reviewer: 'claude' },
    prompt: 'The padding test fails. Make it pass.',
    files: {
      'package.json': NODE_PKG('pad'),
      'pad.js': "const leftPad = require('left-pad')\nfunction code(n) {\n  return leftPad(String(n), 6, '0')\n}\nmodule.exports = { code }\n",
      'pad.test.js': "const { test } = require('node:test')\nconst assert = require('node:assert/strict')\nconst { code } = require('./pad.js')\ntest('pads', () => assert.equal(code(42), '000042'))\n"
    },
    verify: (root) => ({ testsAfterApply: run('node', ['--test'], root) })
  },
  'large-project': {
    assignment: { planner: 'claude', implementer: 'claude', reviewer: 'claude' },
    prompt: 'calculateDiscount applies the discount twice. Find it and fix it.',
    files: (() => {
      const files = { 'package.json': NODE_PKG('big') }
      for (let i = 0; i < 300; i++) {
        const n = String(i).padStart(3, '0')
        files[`src/area${Math.floor(i / 30)}/module_${n}.js`] = i === 157
          ? 'function calculateDiscount(price, pct) {\n  const once = price * (1 - pct / 100)\n  return once * (1 - pct / 100)\n}\nmodule.exports = { calculateDiscount }\n'
          : `function helper${n}(x) {\n  return x + ${i}\n}\nmodule.exports = { helper${n} }\n`
      }
      files['test/discount.test.js'] = "const { test } = require('node:test')\nconst assert = require('node:assert/strict')\nconst { calculateDiscount } = require('../src/area5/module_157.js')\ntest('discount', () => assert.equal(calculateDiscount(200, 10), 180))\n"
      return files
    })(),
    verify: (root) => ({ testsAfterApply: run('node', ['--test'], root) })
  }
}

const names = wanted.length ? wanted : Object.keys(SCENARIOS)
const results = []
const save = () => writeFileSync(out, JSON.stringify(results, null, 2))
const dataDir = mkdtempSync(join(tmpdir(), 'hydra-scn-data-'))
const engine = await Engine.open({ dataDir })
results.push({ providers: engine.registry.status().map((p) => ({ id: p.id, version: p.version, ready: p.installed && !p.problems.length })) })

async function until(id, predicate, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const t = engine.store.getTask(id)
    if (predicate(t)) return t
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`timeout at ${engine.store.getTask(id).stage}/${engine.store.getTask(id).status}`)
}

for (const name of names) {
  const fx = SCENARIOS[name]
  const started = Date.now()
  const record = { scenario: name, assignment: fx.assignment }
  results.push(record)
  try {
    const root = repo(fx.files)
    const project = (await engine.execute({ type: 'project.add', root })).result
    const ack = await engine.execute({ type: 'task.create', projectId: project.id, prompt: fx.prompt, depth: 'deep', mode: 'developer', assignment: fx.assignment })
    if (!ack.ok) throw new Error(ack.error.message)
    const id = ack.result.id
    const t = await until(id, (x) => ['waiting_input', 'completed', 'failed', 'canceled', 'paused'].includes(x.status), 40 * 60_000)
    const detail = engine.taskDetail(id)
    Object.assign(record, {
      status: t.status, waitReason: t.waitReason, error: t.error, route: t.route, checks: t.checks.map((c) => c.label), fixRounds: t.fixRound,
      stages: t.stages.map((s) => `${s.stage}#${s.attempt}:${s.status}`),
      planSummary: t.plan?.summary, planSteps: t.plan?.steps, review: t.review && { verdict: t.review.verdict, findings: t.review.findings.map((f) => `${f.severity}: ${f.issue.slice(0, 140)}`) },
      evidence: detail.evidence.map((e) => ({ phase: e.phase, label: e.label, exit: e.exitCode, spawnError: e.spawnError, ms: e.durationMs })),
      demo: t.demo?.deltas, runs: detail.runs.map((r) => ({ provider: r.provider, role: r.role, stage: r.stage, status: r.status, costUsd: r.usage.costUsd, tokens: r.usage.inputTokens + r.usage.outputTokens, error: r.error?.slice(0, 200) })),
      usage: t.usage, msToResult: Date.now() - started,
      userBranchUntouchedBeforeAccept: execFileSync('git', ['log', '--oneline'], { cwd: root, encoding: 'utf8' }).trim().split('\n').length === 1
    })
    if (t.status === 'waiting_input' && t.waitReason === 'final_approval') {
      const diff = await engine.taskDiff(id)
      record.diff = diff.files.map((f) => `${f.status} ${f.path} +${f.additions}/-${f.deletions}`)
      const accept = await engine.execute({ type: 'task.decide', taskId: id, decision: 'accept', headSha: t.workspace.headSha })
      const done = await until(id, (x) => x.status === 'completed' || (x.status === 'waiting_input' && x.error) || x.status === 'failed', 5 * 60_000)
      record.accept = { ok: accept.ok, outcome: done.outcome, error: done.error, independent: fx.verify(root) }
      if (fx.rollback && done.outcome === 'applied') {
        const rb = await engine.execute({ type: 'task.rollback', taskId: id })
        record.rollback = { ok: rb.ok, moneyModuleGone: !existsSync(join(root, 'src/money.js')), testsAfterRollback: run('node', ['--test'], root) }
      }
    }
  } catch (error) {
    record.error = String(error?.stack ?? error)
  }
  record.ms = Date.now() - started
  save()
  console.log(JSON.stringify({ scenario: name, status: record.status, outcome: record.accept?.outcome, independent: record.accept?.independent, ms: record.ms, costUsd: record.usage?.costUsd, error: record.error?.slice?.(0, 200) }))
}
await engine.close()
