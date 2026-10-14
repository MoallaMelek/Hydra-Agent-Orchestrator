import { describe, expect, it } from 'vitest'
import { classifyRequest, routeRequest } from './route.js'
import { DEV, HELD_OUT } from './route.dataset.js'

// [request, expected depth, expected risk]
const CASES: Array<[string, 'fast' | 'standard' | 'deep', 'normal' | 'high']> = [
  ['hi', 'fast', 'normal'],
  ['Hello!', 'fast', 'normal'],
  ['thanks', 'fast', 'normal'],
  ['bonjour', 'fast', 'normal'],
  ['What is Hydra?', 'fast', 'normal'],
  ['are you a good platform? i built you, are you able to improve yourself?', 'fast', 'normal'],
  ['What does this error mean: TypeError: cannot read properties of undefined?', 'standard', 'normal'],
  ['Explain what this function does', 'standard', 'normal'],
  ['What does add() in math.js return?', 'standard', 'normal'],
  ['How is authentication wired in this repo?', 'standard', 'normal'],
  ['Where is the cart total computed?', 'fast', 'normal'],
  ['Why does the test in cart.test.js fail?', 'standard', 'normal'],
  ['Which files handle the API endpoints?', 'standard', 'normal'],
  ['Fix add() so the test passes', 'deep', 'normal'],
  ['Add a dark mode toggle to the settings page', 'deep', 'normal'],
  ['please refactor the payment module into smaller files', 'deep', 'normal'],
  ['Can you fix the failing test in cart.test.js?', 'deep', 'normal'],
  ['Could you add input validation to the signup form?', 'deep', 'normal'],
  ['I want to migrate the config from JSON to YAML', 'deep', 'normal'],
  ['Rename getUser to fetchUser everywhere', 'deep', 'normal'],
  ['Implement retries with exponential backoff in the http client', 'deep', 'normal'],
  ['the login form crashes when the email field is empty and the submit button is pressed', 'deep', 'normal'],
  ['Delete the database', 'deep', 'high'],
  ['drop the users table', 'deep', 'high'],
  ['force push the branch to main', 'deep', 'high'],
  ['Update the production deploy script', 'deep', 'high'],
  ['remove the API key from config.json', 'deep', 'high'],
  ['How do I rotate the API keys safely?', 'standard', 'high'],
  ['What happens if I delete the database?', 'standard', 'high'],
  ['Remove all records from the users table', 'deep', 'high'],
  ['clear   the\nproduction-like customers   data before the demo', 'deep', 'high'],
  ['the old backups: please purge them', 'deep', 'high'],
  ['Remove the unused import in utils.ts', 'deep', 'normal'],
  ['Add a reset button to the form', 'deep', 'normal'],
  ['ok', 'fast', 'normal']
]

describe('request routing', () => {
  it.each(CASES)('%s → %s (%s risk)', (text, depth, risk) => {
    expect(classifyRequest(text)).toMatchObject({ depth, risk })
  })

  it('is accurate on the whole table and fast enough to run on every keystroke', () => {
    const started = performance.now()
    let right = 0
    for (let i = 0; i < 100; i++) for (const [text, depth, risk] of CASES) { const r = classifyRequest(text); if (i === 0 && r.depth === depth && r.risk === risk) right++ }
    const perCallMs = (performance.now() - started) / (100 * CASES.length)
    expect(right).toBe(CASES.length)
    expect(perCallMs).toBeLessThan(0.5)
  })

  it('a manual choice sets the depth but never hides risk', () => {
    expect(routeRequest('delete the database', 'fast')).toMatchObject({ depth: 'fast', auto: false, risk: 'high' })
    expect(routeRequest('hi', 'deep')).toMatchObject({ depth: 'deep', auto: false })
    expect(routeRequest('hi')).toMatchObject({ depth: 'fast', auto: true })
  })
})

describe('router evaluation (route.dataset.ts)', () => {
  const score = (cases: typeof DEV) => {
    let exact = 0, riskMissed = 0
    const failures: string[] = []
    for (const k of cases) {
      const r = classifyRequest(k.text)
      const intent = r.depth === 'deep' ? 'change' : 'answer'
      if (intent === k.intent && r.risk === k.risk) exact++
      else failures.push(`${k.text} → ${intent}/${r.risk}`)
      if (k.risk === 'high' && r.risk !== 'high') riskMissed++
    }
    return { accuracy: exact / cases.length, riskMissed, failures }
  }

  it('never misses a high-risk request, on the tuning set or the held-out set', () => {
    expect(score(DEV).riskMissed).toBe(0)
    expect(score(HELD_OUT).riskMissed).toBe(0)
  })

  it('keeps accuracy at the measured level (dev 98.7%, held-out 94.7% when written)', () => {
    expect(score(DEV).accuracy).toBeGreaterThanOrEqual(0.97)
    expect(score(HELD_OUT).accuracy).toBeGreaterThanOrEqual(0.94)
  })
})
