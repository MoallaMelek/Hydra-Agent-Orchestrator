import { StringDecoder } from 'node:string_decoder'
import { redact } from './redact.js'

/** Bounded, per-stream line redaction. Never releases an incomplete credential.
 * Oversize lines and PEM bodies are withheld rather than flushed in raw pieces.
 */
export class LogRedactor {
  private readonly decoder = new StringDecoder('utf8')
  private line = ''
  private dropping = false
  private pem = false
  private context = ''
  static readonly limit = 64 * 1024

  push(chunk: Buffer): string { return this.consume(this.decoder.write(chunk)) }
  end(): string {
    let out = this.consume(this.decoder.end())
    if (this.line && !this.dropping) out += this.complete(this.line)
    if (this.context) out += redact(this.context)
    this.context = ''
    this.line = ''
    return out
  }
  private consume(text: string): string {
    let out = ''
    for (const part of text.split(/(?<=\n)/)) {
      if (!this.dropping) {
        this.line += part
        if (this.line.length > LogRedactor.limit) {
          // A long PEM header/body is suppressed along with the whole line.
          if (this.line.includes('-----BEGIN ')) this.pem = true
          out += '[redacted oversized log line]\n'
          this.line = ''
          this.dropping = true
        }
      }
      if (part.endsWith('\n')) {
        if (!this.dropping) out += this.complete(this.line)
        this.line = ''
        this.dropping = false
      }
    }
    return out
  }
  private complete(line: string): string {
    if (this.pem) {
      if (/-----END [A-Z0-9 ]*-----/.test(line)) this.pem = false
      return ''
    }
    if (/-----BEGIN [A-Z0-9 ]*-----/.test(line)) {
      this.pem = !/-----END [A-Z0-9 ]*-----/.test(line)
      return '[redacted key block]\n'
    }
    const text = this.context + line
    // Existing credential patterns allow whitespace (including newlines) before
    // separators, auth schemes and values. Keep that unfinished context private.
    const waiting = /(?:\b(?:password|passwd|secret|token|api[_-]?key)\s*(?:[=:]\s*["']?)?|\bAuthorization\s*:\s*(?:(?:Bearer|Basic|Token|Bot)\s*)?|\bBearer\s*|(?:^|\s)--?(?:token|api[-_]?key|password|passwd|secret|auth(?:[-_]token)?|access[-_]token|client[-_]secret|private[-_]key)(?:=|\s+)?["']?)\s*$/i
    if (waiting.test(text)) {
      if (text.length > LogRedactor.limit) {
        // Compress only withheld whitespace, retain the small credential suffix,
        // and suppress the discarded context instead of exposing fragments.
        this.context = text.replace(/\s+/g, ' ').slice(-512)
        return '[redacted oversized credential context]\n'
      }
      this.context = text
      return ''
    }
    this.context = ''
    return redact(text)
  }
}
