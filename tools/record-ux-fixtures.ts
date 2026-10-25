/**
 * Records disposable UX fixtures for the design rebuild.
 *
 * Real Hydra engine, real Git worktrees and real check processes; the agents are the
 * deterministic ScriptedAdapter (no provider is called). Tool-call reports come from the
 * script, so they are SCRIPTED activity, never model activity. The output journal is the
 * engine's own event stream (EventEnvelope[]), plus task details and diffs read through
 * the engine's public read API. Run: node tools/record-ux-fixtures.bundle.mjs <out.json>
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '../packages/engine/src/engine.js'
import { AdapterRegistry } from '../packages/engine/src/agents/registry.js'
import { ScriptedAdapter, type ScriptedStep } from '../packages/engine/src/agents/scripted.js'
import { makeRepo } from '../packages/engine/src/testing/fixtures.js'
import { approvalContext, type EventEnvelope, type Task } from '@hydra/protocol'

const LEDGER: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'ledger-api', private: true, scripts: { build: "node -e \"require('./src/invoice.js')\"", test: 'node --test' } }, null, 2),
  '.gitignore': 'node_modules/\n',
  'src/cart.js': "const { linePrice } = require('./pricing.js')\n\nfunction total(cart) {\n  return cart.items.reduce((sum, item) => sum + linePrice(item), 0)\n}\n\nmodule.exports = { total }\n",
  'src/pricing.js': "function linePrice(item) {\n  return item.price\n}\n\nfunction discount(amount, percent) {\n  return amount - amount * percent / 100\n}\n\nmodule.exports = { linePrice, discount }\n",
  'src/tax.js': "const RATES = { TN: 19, FR: 20, DE: 19 }\n\nfunction withTax(amount, country) {\n  const rate = RATES[country] ?? 0\n  return Math.round(amount * (100 + rate)) / 100\n}\n\nmodule.exports = { withTax, RATES }\n",
  'src/format.js': "function money(amount, currency = 'TND') {\n  return `${amount.toFixed(3)} ${currency}`\n}\n\nmodule.exports = { money }\n",
  'src/invoice.js': "const { total } = require('./cart.js')\nconst { withTax } = require('./tax.js')\nconst { money } = require('./format.js')\n\nfunction invoice(cart, country) {\n  return money(withTax(total(cart), country))\n}\n\nmodule.exports = { invoice }\n",
  'test/cart.test.js': "const { test } = require('node:test')\nconst assert = require('node:assert/strict')\nconst { total } = require('../src/cart.js')\n\ntest('single items', () => {\n  assert.equal(total({ items: [{ price: 10, qty: 1 }, { price: 5, qty: 1 }] }), 15)\n})\n\ntest('quantities', () => {\n  assert.equal(total({ items: [{ price: 10, qty: 2 }, { price: 5, qty: 2 }] }), 30)\n})\n",
  'test/tax.test.js': "const { test } = require('node:test')\nconst assert = require('node:assert/strict')\nconst { withTax } = require('../src/tax.js')\n\ntest('tunisian vat', () => {\n  assert.equal(withTax(100, 'TN'), 119)\n})\n",
  'README.md': '# ledger-api\n\nPricing, tax and invoice helpers.\n'
}

const PRICING_FIXED = "function linePrice(item) {\n  const qty = Number.isInteger(item.qty) && item.qty > 0 ? item.qty : 1\n  return item.price * qty\n}\n\nfunction discount(amount, percent) {\n  return amount - amount * percent / 100\n}\n\nmodule.exports = { linePrice, discount }\n"
const PRICING_PARTIAL = "function linePrice(item) {\n  return item.price * item.qty\n}\n\nfunction discount(amount, percent) {\n  return amount - amount * percent / 100\n}\n\nmodule.exports = { linePrice, discount }\n"
const PRICING_TEST = "const { test } = require('node:test')\nconst assert = require('node:assert/strict')\nconst { linePrice } = require('../src/pricing.js')\n\ntest('missing quantity counts once', () => {\n  assert.equal(linePrice({ price: 7 }), 7)\n})\n\ntest('quantity multiplies', () => {\n  assert.equal(linePrice({ price: 7, qty: 3 }), 21)\n})\n"
const PRICING_TEST_WRONG = PRICING_TEST.replace('linePrice({ price: 7 }), 7', 'linePrice({ price: 7 }), 0')

type Scenario = 'repair' | 'verify-fail' | 'clean' | 'question' | 'plan-gate' | 'failure'
let scenario: Scenario = 'repair'
let implCalls = 0
let reviewCalls = 0

const T = (name: string, summary: string) => ({ name, summary })
const PLAN_TOOLS = [T('Glob', 'src/**/*.js'), T('Read', 'src/cart.js'), T('Read', 'src/pricing.js'), T('Read', 'src/invoice.js'), T('Grep', 'linePrice\\('), T('Read', 'test/cart.test.js')]
const BUILD_TOOLS = [T('Read', 'src/pricing.js'), T('Edit', 'src/pricing.js'), T('Bash', 'npm test')]
const REPAIR_TOOLS = [T('Read', 'src/pricing.js'), T('Edit', 'src/pricing.js'), T('Write', 'test/pricing.test.js'), T('Bash', 'node --test test/')]
const REVIEW_TOOLS = [T('Bash', 'git diff --stat HEAD~1'), T('Read', 'src/pricing.js'), T('Read', 'test/pricing.test.js'), T('Grep', 'qty'), T('Read', 'src/invoice.js')]

const usage = (i: number, o: number, c: number | null) => ({ inputTokens: i, outputTokens: o, costUsd: c })

const handler = (request: { role: string }): ScriptedStep => {
  if (request.role === 'planner') {
    if (scenario === 'question') return { delayMs: 2600, tools: [T('Glob', 'src/**/*.js'), T('Read', 'src/invoice.js'), T('Read', 'src/tax.js'), T('Grep', 'RATES')], text: 'Invoices compute the cart total in `src/cart.js`, apply VAT from `src/tax.js` (`RATES`, rounded to cents) and format with `src/format.js`. Unknown countries fall back to 0% VAT, which silently under-charges. *Scripted fixture answer, not model output.*', usage: usage(9_400, 620, 0.031) }
    return { delayMs: 2400, tools: PLAN_TOOLS, usage: usage(12_800, 1_150, 0.046), structured: {
      summary: 'Make cart totals respect item quantity by fixing linePrice(), and cover missing/invalid quantities with tests.',
      steps: ['Trace total() through linePrice() in src/pricing.js', 'Multiply price by a validated quantity (default 1)', 'Add test/pricing.test.js for missing and multiple quantities', 'Run the full test suite'],
      acceptanceCriteria: ['total() multiplies price by quantity', 'Items without qty still count once', 'All existing tests pass'],
      risks: scenario === 'plan-gate' ? ['Changes pricing for every invoice; downstream totals will differ'] : ['Invoice totals change for carts with qty > 1'],
      filesLikelyTouched: ['src/pricing.js', 'test/pricing.test.js']
    } }
  }
  if (request.role === 'implementer') {
    implCalls++
    if (scenario === 'failure') return { delayMs: 1800, tools: [T('Read', 'src/pricing.js')], fail: 'Scripted execution failure: provider process exited (fixture; no provider was called).' }
    if (scenario === 'repair' && implCalls === 1) return { delayMs: 3200, tools: BUILD_TOOLS, files: { 'src/pricing.js': PRICING_PARTIAL }, structured: { summary: 'Multiplied price by qty in linePrice().', followUps: [] }, usage: usage(18_200, 2_300, null) }
    if (scenario === 'verify-fail' && implCalls === 1) return { delayMs: 3000, tools: REPAIR_TOOLS, files: { 'src/pricing.js': PRICING_FIXED, 'test/pricing.test.js': PRICING_TEST_WRONG }, structured: { summary: 'Fixed linePrice and added tests.', followUps: [] }, usage: usage(17_900, 2_900, null) }
    return { delayMs: 3400, tools: REPAIR_TOOLS, files: { 'src/pricing.js': PRICING_FIXED, 'test/pricing.test.js': PRICING_TEST }, structured: { summary: 'linePrice() multiplies by a validated quantity (default 1); new pricing tests.', followUps: ['Consider rejecting negative quantities at the API boundary'] }, usage: usage(16_400, 3_100, null) }
  }
  reviewCalls++
  const object = scenario === 'repair' && reviewCalls === 1
  return { delayMs: 2200, tools: REVIEW_TOOLS, usage: usage(21_000, 1_400, 0.071), structured: {
    verdict: object ? 'changes_requested' : 'approve',
    summary: object ? '**Scripted review fixture.** Quantity is multiplied, but items without `qty` now produce `NaN`, and no test covers it.' : '**Scripted review fixture.** Quantity handling is validated and covered by tests. Inspect the exact revision and engine-run evidence.',
    findings: object ? [
      { severity: 'blocker', file: 'src/pricing.js', issue: 'Items without qty yield NaN totals (price * undefined).', suggestion: 'Default a missing or invalid qty to 1.' },
      { severity: 'major', file: 'test/pricing.test.js', issue: 'No test covers missing or multiple quantities.', suggestion: 'Add tests for both cases.' },
      { severity: 'nit', file: 'src/invoice.js', issue: 'invoice() silently uses 0% VAT for unknown countries.', suggestion: 'Out of scope; record as follow-up.' }
    ] : [{ severity: 'nit', file: 'src/invoice.js', issue: 'invoice() silently uses 0% VAT for unknown countries.', suggestion: 'Out of scope; record as follow-up.' }],
    acceptanceCriteriaMet: [
      { criterion: 'total() multiplies price by quantity', met: true, note: 'Scripted review, not a model judgment.' },
      { criterion: 'Items without qty still count once', met: !object, note: object ? 'NaN for missing qty.' : 'Covered by test/pricing.test.js.' },
      { criterion: 'All existing tests pass', met: !object, note: 'See engine-run checks.' }
    ]
  } }
}

const dataDir = mkdtempSync(join(tmpdir(), 'hydra-ux-fixtures-'))
const engine = await Engine.open({ dataDir, skipProbe: true, registry: new AdapterRegistry([new ScriptedAdapter(handler)]) })
const journal: EventEnvelope[] = []
engine.subscribe((envelope) => journal.push(envelope))
const missions: Array<{ scenario: Scenario; taskId: string; projectId: string }> = []
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function project(name: string): Promise<string> {
  const ack = await engine.execute({ type: 'project.add', root: makeRepo(LEDGER), name })
  if (!ack.ok) throw new Error(ack.error.message)
  return (ack.result as { id: string }).id
}

async function mission(projectId: string, s: Scenario, title: string, prompt: string, opts: { mode?: 'safe' | 'developer'; intent?: 'change' | 'analyze'; fixRounds?: number } = {}) {
  scenario = s; implCalls = 0; reviewCalls = 0
  const ack = await engine.execute({ type: 'task.create', projectId, title, prompt, intent: opts.intent ?? 'change', depth: opts.intent === 'analyze' ? 'standard' : 'deep', mode: opts.mode ?? 'developer', assignment: { planner: 'scripted', implementer: 'scripted', reviewer: 'scripted' }, budget: { maxFixRounds: opts.fixRounds ?? 2 } })
  if (!ack.ok) throw new Error(ack.error.message)
  const taskId = (ack.result as Task).id
  for (let i = 0; i < 3000; i++) {
    const task = engine.store.getTask(taskId)!
    if (task.status === 'waiting_input' && task.waitReason === 'plan_approval' && s !== 'plan-gate') {
      await sleep(1200)
      const ok = await engine.execute({ type: 'task.approve_plan', taskId, approve: true })
      if (!ok.ok) throw new Error(ok.error.message)
      continue
    }
    if (task.status === 'waiting_input' || task.status === 'completed' || task.status === 'failed') break
    await sleep(100)
  }
  missions.push({ scenario: s, taskId, projectId })
  return taskId
}

try {
  const ledger = await project('ledger-api')
  await mission(ledger, 'question', 'How are invoice taxes computed?', 'How does invoice() compute VAT, and what happens for an unknown country?', { intent: 'analyze' })
  await mission(ledger, 'repair', 'Cart totals ignore quantity', 'Cart totals ignore item quantity. Fix total() and add tests for missing and multiple quantities.')
  await mission(ledger, 'verify-fail', 'Quantity-aware pricing with tests', 'Make linePrice quantity-aware and add pricing tests.', { fixRounds: 0 })
  // Applied last, so the earlier missions start from the original code.
  const accepted = await mission(ledger, 'clean', 'Round invoice totals to millimes', 'Invoices for Tunisia must round to 3 decimals. Check pricing and make totals quantity-aware.')
  {
    const t = engine.store.getTask(accepted)!
    if (t.status === 'waiting_input' && t.waitReason === 'final_approval') {
      const detail = engine.taskDetail(accepted)
      const ok = await engine.execute({ type: 'task.decide', taskId: accepted, decision: 'accept', headSha: t.workspace!.headSha!, acceptance: { decisionId: crypto.randomUUID(), snapshot: approvalContext(t, detail.evidence).snapshot } })
      if (!ok.ok) console.error('accept refused:', ok.error.message)
      await sleep(1500)
    }
  }
  const shop = await project('storefront-web')
  await mission(shop, 'plan-gate', 'Change pricing for every invoice', 'Rewrite linePrice so every invoice uses quantity-aware totals.', { mode: 'safe' })
  await mission(shop, 'failure', 'Normalize currency formatting', 'Use one currency formatter across invoices.')

  const details = Object.fromEntries(missions.map((m) => [m.taskId, engine.taskDetail(m.taskId)]))
  const diffs: Record<string, unknown> = {}
  for (const m of missions) { try { diffs[m.taskId] = await engine.taskDiff(m.taskId) } catch (e) { diffs[m.taskId] = { unavailable: String(e) } } }
  const out = { recordedAt: new Date().toISOString(), source: 'Real Hydra engine, Git worktrees and check processes. Agents: ScriptedAdapter (deterministic test adapter). Tool-call reports and agent text are SCRIPTED, not model activity. No provider was called.', missions, snapshot: engine.snapshot(), details, diffs, journal }
  writeFileSync(process.argv[2] ?? join(dataDir, 'ux-fixtures.json'), JSON.stringify(out, null, 1))
  console.log(JSON.stringify({ dataDir, missions: missions.map((m) => ({ ...m, status: engine.store.getTask(m.taskId)!.status, stage: engine.store.getTask(m.taskId)!.stage, wait: engine.store.getTask(m.taskId)!.waitReason, outcome: engine.store.getTask(m.taskId)!.outcome })), events: journal.length }, null, 2))
} finally { await engine.close() }
