/**
 * Provider sign-in detection. Hydra asks each CLI whether *its own* credential
 * store has a signed-in account. Only a boolean and a short method label leave
 * this module; email, organisation and any token material are discarded here.
 */
export interface AuthState {
  authenticated: boolean | null
  method: string | null
}

const METHOD_LABEL = /^[A-Za-z0-9 ._-]{1,40}$/

const label = (value: unknown): string | null =>
  typeof value === 'string' && METHOD_LABEL.test(value) ? value : null

export function parseClaudeAuthStatus(stdout: string): AuthState {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>
    if (typeof parsed.loggedIn !== 'boolean') return { authenticated: null, method: null }
    return { authenticated: parsed.loggedIn, method: parsed.loggedIn ? label(parsed.authMethod) : null }
  } catch {
    return { authenticated: null, method: null }
  }
}

export function parseCodexLoginStatus(output: string): AuthState {
  const text = output.trim()
  if (/not logged in/i.test(text)) return { authenticated: false, method: null }
  const match = /logged in using (?:an? )?([A-Za-z0-9 ._-]{1,40})/i.exec(text)
  if (match) return { authenticated: true, method: match[1]!.trim() }
  return { authenticated: null, method: null }
}

export const SIGN_IN_HELP = {
  claude: 'Claude Code is not signed in. Open a terminal and run `claude auth login` with your own Anthropic account (or set ANTHROPIC_API_KEY in your environment). Hydra never handles your credentials.',
  codex: 'Codex CLI is not signed in. Open a terminal and run `codex login` with your own OpenAI/ChatGPT account. Hydra never handles your credentials.'
} as const
