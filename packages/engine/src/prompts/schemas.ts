/**
 * JSON Schemas handed to providers for enforced structured output. They follow the
 * strict subset accepted by both CLIs: every property required, no extra keys,
 * nullable values expressed as type unions. Hydra re-validates with zod.
 */
const str = (maxLength: number) => ({ type: 'string', maxLength })
const strList = (maxItems: number, maxLength = 1000) => ({ type: 'array', maxItems, items: str(maxLength) })
const obj = (properties: Record<string, unknown>) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties })

export const PLAN_SCHEMA = obj({
  summary: str(4000),
  steps: { ...strList(30), minItems: 1 },
  acceptanceCriteria: { ...strList(20), minItems: 1 },
  risks: strList(20),
  filesLikelyTouched: strList(100, 500)
})

export const ANSWER_SCHEMA = obj({
  answer: str(20_000),
  keyFindings: strList(20),
  filesReferenced: strList(50, 500)
})

export const IMPLEMENT_SCHEMA = obj({
  summary: str(4000),
  followUps: strList(20)
})

export const REVIEW_SCHEMA = obj({
  verdict: { type: 'string', enum: ['approve', 'changes_requested'] },
  summary: str(4000),
  findings: {
    type: 'array', maxItems: 50,
    items: obj({
      severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'nit'] },
      file: { type: ['string', 'null'], maxLength: 500 },
      issue: str(2000),
      suggestion: str(2000)
    })
  },
  acceptanceCriteriaMet: {
    type: 'array', maxItems: 20,
    items: obj({ criterion: str(1000), met: { type: 'boolean' }, note: str(1000) })
  }
})
