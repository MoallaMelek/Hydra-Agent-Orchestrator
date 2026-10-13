/** Variables that change how runtimes load code; never forwarded to children. */
const INJECTION_VARS = /^(NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE|ELECTRON_.*|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|PYTHONSTARTUP|PYTHONPATH|PERL5OPT|RUBYOPT|JAVA_TOOL_OPTIONS|_JAVA_OPTIONS|HYDRA_.*)$/i

/** Variables a build/test toolchain legitimately needs. Everything else is dropped for verification. */
const VERIFY_ALLOW = /^(PATH|PATHEXT|HOME|USERPROFILE|HOMEDRIVE|HOMEPATH|APPDATA|LOCALAPPDATA|PROGRAMDATA|PROGRAMFILES|PROGRAMFILES\(X86\)|COMMONPROGRAMFILES|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|LANG|LC_.*|TZ|TERM|SHELL|USER|USERNAME|LOGNAME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|OS|JAVA_HOME|GOPATH|GOROOT|GOCACHE|GOMODCACHE|CARGO_HOME|RUSTUP_HOME|VIRTUAL_ENV|CONDA_PREFIX|PYENV_ROOT|NVM_DIR|VOLTA_HOME|PNPM_HOME|COREPACK_HOME|NPM_CONFIG_CACHE|MAVEN_HOME|GRADLE_USER_HOME|ANDROID_HOME|XDG_.*)$/i

export function agentEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && !INJECTION_VARS.test(key)) env[key] = value
  }
  env.NO_COLOR = '1'
  return env
}

export function verificationEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && VERIFY_ALLOW.test(key) && !INJECTION_VARS.test(key)) env[key] = value
  }
  // Non-interactive, no watch mode, no colour codes in evidence.
  env.CI = '1'
  env.NO_COLOR = '1'
  env.FORCE_COLOR = '0'
  env.PYTHONDONTWRITEBYTECODE = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  return env
}
