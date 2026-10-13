import { z } from 'zod'

/**
 * How much machinery a request needs.
 * - fast: conversation or general question; one streamed answer.
 * - standard: a question about this repository; one streamed answer with read-only tools.
 * - deep: a change to the code; plan, implement, review, verify and approval.
 */
export const Depth = z.enum(['fast', 'standard', 'deep'])
export type Depth = z.infer<typeof Depth>
export const DepthChoice = z.enum(['auto', 'fast', 'standard', 'deep'])
export type DepthChoice = z.infer<typeof DepthChoice>

export const Route = z.object({
  depth: Depth,
  /** True when Hydra chose the depth; false when the user picked it. */
  auto: z.boolean(),
  /** High-risk requests always require plan approval, whatever the user picked. */
  risk: z.enum(['normal', 'high']),
  reason: z.string().max(200)
})
export type Route = z.infer<typeof Route>

const GREETING = /^(hi|hello|hey|yo|hiya|howdy|thanks|thank you|thx|ok|okay|cool|great|nice|good (morning|afternoon|evening)|bonjour|salut|merci|salam|hola)\b[\s!.,?]*/i
const QUESTION_START = /^(what|why|how|where|when|who|whom|which|whose|is|are|was|were|does|do|did|can|could|should|would|will|has|have|explain|describe|tell me|show me|list|summari[sz]e|walk me through|compare|qu(e|')|pourquoi|comment|o[uù]|quel|est-ce)\b/i
// Verbs that ask for the code to change, in imperative or request form ("fix x", "please add", "can you fix").
const CHANGE_VERB = '(add|fix|implement|create|refactor|rename|remove|delete|update|change|make|write|build|migrate|upgrade|replace|convert|optimi[sz]e|improve|support|handle|bump|move|split|extract|introduce|enable|disable|clean ?up|rewrite|port|patch|correct|repair|install|set ?up|configure|translate|format|lint|document|test)'
const CHANGE_IMPERATIVE = new RegExp(`^(please\\s+)?${CHANGE_VERB}\\b`, 'i')
const CHANGE_REQUEST = new RegExp(`\\b(can|could|would|will) you\\s+(please\\s+)?${CHANGE_VERB}\\b|\\b(i want|i need|we need|let'?s|go ahead and|please)\\s+(you to\\s+|to\\s+)?${CHANGE_VERB}\\b`, 'i')
const CODE_REFERENCE = /[\w-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|json|ya?ml|toml|md|sql|sh|css|html)\b|`[^`]+`|\b(function|method|class|module|file|repo(sitory)?|codebase|component|endpoint|api|test|bug|error|stack trace|exception|database|schema|config|dependency|package)\b|\w+\(\)/i
// A bug report stated as a fact ("the form crashes when…") usually means "fix it".
const SYMPTOM = /\b(crash(es|ed|ing)?|broken|breaks|fails?|failing|throws|hangs|freezes|doesn'?t work|does not work|not working|wrong|incorrect|regress(ion|ed)?)\b/i
const HIGH_RISK = /\b(drop|truncate|wipe|purge|erase|destroy)\b|\bdelete\b.*\b(database|db|table|tables|all|everything|data|branch|repo(sitory)?|users?|records?|history)\b|rm\s+-rf|force[- ]push|push\s+(-f|--force)|reset\s+--hard|\b(prod|production)\b|\bdeploy\b|\b(credentials?|secrets?|passwords?|api[ -]?keys?|tokens?)\b|\bchmod\b|\bsudo\b/i

// A destructive verb near something that holds data, in either order ("remove all records
// from the users table", "the users table: clear it").
const DESTROY_VERB = '(delete|deletes|deleting|remove|removes|removing|drop|dropping|truncate|wipe|wiping|purge|erase|clear|clearing|destroy|reset|overwrite|nuke)'
const DATA_OBJECT = '(database|databases|db|table|tables|records?|rows?|data|dataset|users?|accounts?|customers?|collections?|buckets?|backups?|branch(es)?|repo(sitory)?|history|migrations?|volumes?|disk|everything|all)'
const DESTROY_NEAR = new RegExp(`\\b${DESTROY_VERB}\\b(\\W+\\w+){0,6}?\\W+${DATA_OBJECT}\\b|\\b${DATA_OBJECT}\\b(\\W+\\w+){0,6}?\\W+${DESTROY_VERB}\\b`, 'i')

/** True for text that asks for (or plans) destructive, secret-handling or production operations. */
export function isHighRisk(text: string): boolean {
  const t = text.replace(/\s+/g, ' ')
  return HIGH_RISK.test(t) || DESTROY_NEAR.test(t)
}

/**
 * Deterministic, instant request classifier (no model call). Errs towards answering:
 * a misrouted question costs one cheap reply, and a reply can always be turned into a change.
 */
export function classifyRequest(text: string): Omit<Route, 'auto'> {
  const t = text.trim()
  const risk = isHighRisk(t) ? 'high' as const : 'normal' as const
  const words = t.split(/\s+/).filter(Boolean).length
  if (CHANGE_IMPERATIVE.test(t) || CHANGE_REQUEST.test(t)) {
    return { depth: 'deep', risk, reason: risk === 'high' ? 'A high-risk change: you will approve the plan first.' : 'Looks like a request to change the code.' }
  }
  if (risk === 'high' && !/\?\s*$/.test(t)) return { depth: 'deep', risk, reason: 'A high-risk request: you will approve the plan first.' }
  if ((GREETING.test(t) && words <= 6) || (words <= 3 && !CODE_REFERENCE.test(t))) return { depth: 'fast', risk, reason: 'Conversation: a quick answer.' }
  if (QUESTION_START.test(t) || /\?\s*$/.test(t)) {
    return CODE_REFERENCE.test(t)
      ? { depth: 'standard', risk, reason: 'A question about the code: Hydra reads what it needs and answers.' }
      : { depth: 'fast', risk, reason: 'A general question: a quick answer.' }
  }
  if (words >= 8 && (CODE_REFERENCE.test(t) || SYMPTOM.test(t))) return { depth: 'deep', risk, reason: 'Looks like a task on the code.' }
  return { depth: 'standard', risk, reason: 'Hydra will answer; ask for a change explicitly if you want one.' }
}

/** The route for a request: the user's pick if any, otherwise the classifier's. Risk is always classified. */
export function routeRequest(text: string, choice: DepthChoice = 'auto'): Route {
  const classified = classifyRequest(text)
  if (choice === 'auto') return { ...classified, auto: true }
  return { depth: choice, auto: false, risk: classified.risk, reason: choice === 'deep' ? 'You asked for the full pipeline.' : choice === 'fast' ? 'You asked for a quick answer.' : 'You asked for an answer about the code.' }
}
