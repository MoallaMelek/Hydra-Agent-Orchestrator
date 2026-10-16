/**
 * Best-effort masking of well-known credential formats before text is persisted
 * or broadcast (evidence tails, logs, agent output). It reduces accidental leakage;
 * it is not a guarantee: unknown secret formats are not detected.
 */
const PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]'],
  [/\bsk-ant-[A-Za-z0-9_-]{16,}/g, '[redacted anthropic key]'],
  [/\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, '[redacted openai key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, '[redacted github token]'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}/g, '[redacted github token]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[redacted aws key id]'],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, '[redacted slack token]'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/g, '[redacted google api key]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted jwt]'],
  [/((?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*["']?)[^\s"']{8,}/gi, '$1[redacted]'],
  // Credentials in commands an agent runs: HTTP auth headers, --token style flags, user:pass@ URLs.
  [/(\bAuthorization\s*:\s*(?:Bearer|Basic|Token|Bot)\s+)[^\s"'\\]+/gi, '$1[redacted]'],
  [/(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, '$1[redacted]'],
  [/((?:^|\s)--?(?:token|api[-_]?key|password|passwd|secret|auth(?:[-_]token)?|access[-_]token|client[-_]secret|private[-_]key)(?:=|\s+)["']?)[^\s"']+/gi, '$1[redacted]'],
  [/(\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:)[^@\s/]+@/gi, '$1[redacted]@']
]

export function redact(text: string): string {
  let out = text
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement)
  return out
}
