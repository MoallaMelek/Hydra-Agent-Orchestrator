/** Variables that change how runtimes load code; never forwarded to children. */
const INJECTION_VARS = /^(NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|ELECTRON_.*|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|PYTHONSTARTUP|PYTHONPATH|PERL5OPT|RUBYOPT|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|HYDRA_.*|GIT_.*)$/i

/** System and toolchain variables any child legitimately needs. */
const SYSTEM_ALLOW = /^(PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|PROGRAMW6432|COMMONPROGRAMFILES|COMMONPROGRAMFILES\(X86\)|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|LANG|LANGUAGE|LC_.*|TZ|TERM|SHELL|USER|USERNAME|LOGNAME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|PROCESSOR_IDENTIFIER|OS|JAVA_HOME|GOPATH|GOROOT|GOCACHE|GOMODCACHE|GOFLAGS|CARGO_HOME|RUSTUP_HOME|VIRTUAL_ENV|CONDA_PREFIX|PYENV_ROOT|NVM_DIR|VOLTA_HOME|PNPM_HOME|COREPACK_HOME|NPM_CONFIG_CACHE|MAVEN_HOME|GRADLE_USER_HOME|ANDROID_HOME|XDG_.*|SSL_CERT_FILE|SSL_CERT_DIR|NODE_EXTRA_CA_CERTS|REQUESTS_CA_BUNDLE)$/i

/** Network proxy settings the provider CLIs need to reach their own APIs. */
const PROXY_ALLOW = /^(HTTPS?_PROXY|NO_PROXY|ALL_PROXY)$/i

/**
 * Provider-specific variables: each CLI receives only its own vendor's settings and
 * credentials (which belong to the customer and live in their environment). Neither
 * CLI ever sees the other vendor's key or unrelated secrets such as cloud tokens.
 */
const PROVIDER_ALLOW: Record<'claude' | 'codex', RegExp> = {
  claude: /^(ANTHROPIC_.*|CLAUDE_.*|DISABLE_TELEMETRY|DISABLE_ERROR_REPORTING)$/i,
  codex: /^(OPENAI_.*|CODEX_.*|AZURE_OPENAI_.*)$/i
}

function pick(base: NodeJS.ProcessEnv, allow: (key: string) => boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !INJECTION_VARS.test(key) && allow(key)) env[key] = value
  }
  return env
}

export function agentEnv(provider: 'claude' | 'codex', base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = pick(base, (key) => SYSTEM_ALLOW.test(key) || PROXY_ALLOW.test(key) || PROVIDER_ALLOW[provider].test(key))
  env.NO_COLOR = '1'
  return env
}

export function verificationEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = pick(base, (key) => SYSTEM_ALLOW.test(key))
  // Non-interactive, no watch mode, no colour codes in evidence.
  env.CI = '1'
  env.NO_COLOR = '1'
  env.FORCE_COLOR = '0'
  env.PYTHONDONTWRITEBYTECODE = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}
