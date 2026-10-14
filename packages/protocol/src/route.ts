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
const QUESTION_START = /^(what|why|how|where|when|who|whom|which|whose|is|are|was|were|does|do|did|can|could|should|would|will|has|have|explain|describe|tell me|show me|list|summari[sz]e|walk me through|compare|review|qu(e|')|pourquoi|comment|o[uù]|quel|est-ce)\b/i
// Verbs that ask for the code to change ("fix x", "please add", "can you fix", "…, then add").
const CHANGE_VERB = '(add|fix|implement|create|refactor|rename|remove|delete|update|change|make|write|build|migrate|upgrade|replace|convert|optimi[sz]e|improve|support|handle|bump|move|split|extract|introduce|enable|disable|clean ?up|rewrite|port|patch|correct|repair|install|set ?up|configure|translate|format|lint|document|test|tidy( up)?|switch|swap|simplify|speed up|harden|reorgani[sz]e|rework|adjust|tweak|polish|modernize|apply|do)'
// Leading words that do not change the request ("ok now fix it", "great, apply that").
const FILLER = /^((ok|okay|alright|all right|great|yes|yeah|yep|sure|cool|perfect|sounds good|good|thanks|now|then|so|and|please)[\s,!.:-]+)+/i
const CHANGE_IMPERATIVE = new RegExp(`^(please\\s+)?${CHANGE_VERB}\\b`, 'i')
// "can you fix", but not "how would you fix" (a question about approach).
const CHANGE_REQUEST = new RegExp(`(?<!\\b(how|what|why|where|which|when)\\s)\\b(can|could|would|will) you\\s+(please\\s+)?${CHANGE_VERB}\\b|\\b(i want|i need|we need|let'?s|let us|go ahead and|please)\\s+(you to\\s+|to\\s+)?${CHANGE_VERB}\\b|\\b(then|and then|also|afterwards)\\s+(please\\s+)?${CHANGE_VERB}\\b|\\b(needs?|should|must|has to|have to)\\s+(also\\s+)?(to\\s+|be\\s+)?${CHANGE_VERB}\\b|\\bto also ${CHANGE_VERB}\\b`, 'i')
// Approval of a previous suggestion: "go ahead", "do it", "go with option 2".
const GO_AHEAD = /^(go ahead|do it|do that|apply (it|that|this)|implement (it|that|this)|make (that|the|this) change|go with|proceed|ship it)\b/i
const CODE_REFERENCE = /[\w-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|json|ya?ml|toml|md|sql|sh|css|html)\b|`[^`]+`|\b(function|method|class|module|file|repo(sitory)?|codebase|component|endpoint|api|test|bug|error|stack trace|exception|database|schema|config|dependency|package|readme|docs?)\b|\w+\(\)/i
// A problem stated as a fact ("the form crashes when…", "the README is out of date") usually means "fix it".
const SYMPTOM = /\b(crash(es|ed|ing)?|broken|breaks|fails?|failing|throws|hangs|freezes|doesn'?t work|does not work|not working|wrong|incorrect|regress(ion|ed)?|out of date|outdated|is slow|are slow|too slow|overlaps?|out of hand|need(s)? (correct|fix|updat|chang|clean)\w*)\b/i
// "password" as a form field is not a secret.
const HIGH_RISK = /\b(drop|truncate|wipe|purge|erase|destroy)\b|\bdelete\b.{0,40}\b(database|db|table|tables|everything|data|branch|branches|repo(sitory)?|users?|records?|history)\b|rm\s+-rf|force[- ]push|push\s+(-f|--force)|reset\s+--hard|\b(prod|production)\b|\bdeploy\b|\b(credentials?|secrets?|api[ -]?keys?|tokens?|private keys?)\b|\bpasswords?\b(?!\s+(field|input|box|is empty|empty))|\.env\b|\bchmod\b|\bsudo\b|curl[^|\n]*\|\s*(ba|z)?sh|wget[^|\n]*\|\s*(ba|z)?sh|ignore (all |the )?(previous|prior|above) instructions|\b(make|set)\b.{0,30}\bpublic\b|\badmin (rights|access|role|privileges)\b|\b(disable|turn off|bypass|skip|remove)\b.{0,40}\b(auth\w*|login|tls|ssl|certificates?|verification|csrf|cors|security|encryption|2fa|mfa|permissions?)\b/i

// A destructive verb near something that holds data, in either order ("remove all records
// from the users table", "the users table: clear it").
const DESTROY_VERB = '(delete|deletes|deleting|remove|removes|removing|drop|dropping|truncate|wipe|wiping|purge|erase|clear|clearing|clean out|empty|destroy|reset|overwrite|nuke)'
const DATA_OBJECT = '(database|databases|db|table|tables|records?|rows?|data|dataset|users?|accounts?|customers?|collections?|buckets?|backups?|branch(es)?|repo(sitory)?|history|migrations?|volumes?|disk|folders?|director(y|ies)|\\.git|everything)'
const DESTROY_NEAR = new RegExp(`\\b${DESTROY_VERB}\\b(\\W+\\w+){0,6}?\\W+${DATA_OBJECT}\\b|\\b${DATA_OBJECT}\\b(\\W+\\w+){0,6}?\\W+${DESTROY_VERB}\\b`, 'i')
// Sending secrets somewhere ("send the .env contents to my server").
const EXFILTRATE = /\b(send|upload|post|paste|share|leak|exfiltrate|email|copy)\b.{0,60}\b(\.env|secrets?|keys?|credentials?|tokens?|passwords?)\b|\b(\.env|secrets?|keys?|credentials?|tokens?|passwords?)\b.{0,60}\b(to (my|a|an|the) (server|site|url|endpoint|webhook)|pastebin|gist)\b/i

/** True for text that asks for (or plans) destructive, secret-handling or production operations. */
export function isHighRisk(text: string): boolean {
  const t = text.replace(/\s+/g, ' ')
  return HIGH_RISK.test(t) || DESTROY_NEAR.test(t) || EXFILTRATE.test(t)
}

/**
 * Deterministic, instant request classifier (no model call). Errs towards answering:
 * a misrouted question costs one cheap reply, and a reply can always be turned into a change.
 * Risk is judged on its own and errs towards flagging.
 */
export function classifyRequest(text: string): Omit<Route, 'auto'> {
  const raw = text.trim()
  const risk = isHighRisk(raw) ? 'high' as const : 'normal' as const
  const t = raw.replace(FILLER, '')
  const words = t.split(/\s+/).filter(Boolean).length
  const question = QUESTION_START.test(t) || /\?\s*$/.test(t)
  const change = { depth: 'deep' as const, risk, reason: risk === 'high' ? 'A high-risk change: you will approve the plan first.' : 'Looks like a request to change the code.' }
  if (GO_AHEAD.test(t) || CHANGE_IMPERATIVE.test(t) || CHANGE_REQUEST.test(t)) return change
  if (risk === 'high' && !question) return { depth: 'deep', risk, reason: 'A high-risk request: you will approve the plan first.' }
  if ((GREETING.test(raw) && words <= 6) || (words <= 3 && !CODE_REFERENCE.test(t) && !SYMPTOM.test(t))) return { depth: 'fast', risk, reason: 'Conversation: a quick answer.' }
  if (question) {
    return CODE_REFERENCE.test(t)
      ? { depth: 'standard', risk, reason: 'A question about the code: Hydra reads what it needs and answers.' }
      : { depth: 'fast', risk, reason: 'A general question: a quick answer.' }
  }
  if (SYMPTOM.test(t) || (words >= 8 && CODE_REFERENCE.test(t))) return { depth: 'deep', risk, reason: 'Looks like a problem to fix in the code.' }
  return { depth: 'standard', risk, reason: 'Hydra will answer; ask for a change explicitly if you want one.' }
}

/** The route for a request: the user's pick if any, otherwise the classifier's. Risk is always classified. */
export function routeRequest(text: string, choice: DepthChoice = 'auto'): Route {
  const classified = classifyRequest(text)
  if (choice === 'auto') return { ...classified, auto: true }
  return { depth: choice, auto: false, risk: classified.risk, reason: choice === 'deep' ? 'You asked for the full pipeline.' : choice === 'fast' ? 'You asked for a quick answer.' : 'You asked for an answer about the code.' }
}
