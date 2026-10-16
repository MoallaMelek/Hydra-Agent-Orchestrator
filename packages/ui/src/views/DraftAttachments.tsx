import { useRef, useState } from 'react'
import { Button } from '../design/components'
import type { Attachment } from '../app/preferences'

/** Text attachments are part of the persisted request, bounded by the existing API limit. */
export function DraftAttachments({ files, onChange, disabled }: { files: Attachment[]; onChange: (files: Attachment[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  const attach = async (list: FileList | null) => {
    if (!list) return
    try {
      if (files.length + list.length > 8) throw new Error('Attach up to eight text files.')
      const next: Attachment[] = []
      for (const file of Array.from(list)) {
        if (file.size > 16000 || !/\.(txt|md|tsx?|jsx?|json|css|html|py|rs|go|ya?ml|toml)$/i.test(file.name)) throw new Error('Use text or code files up to 16 KB.')
        if (/^\.env(?:\.|$)|(?:auth|token|credential|secret|service[-_]?account)[^/\\]*\.json$|\.(pem|key|p12|pfx)$/i.test(file.name)) throw new Error('Credential attachments are not accepted.')
        const content = await file.text()
        if (content.includes('\0')) throw new Error('Binary files are not accepted.')
        next.push({ name: file.name, content })
      }
      onChange([...files, ...next]); setError('')
    } catch (e) { setError((e as Error).message) }
  }
  return <div className="draft-files">
    <input ref={input} className="sr-only" type="file" aria-label="Attach text files" multiple disabled={disabled} onChange={event => { void attach(event.target.files); event.target.value = '' }} />
    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => input.current?.click()}>Attach text</Button>
    {files.map((file, index) => <Button key={`${file.name}-${index}`} size="sm" variant="ghost" disabled={disabled} onClick={() => onChange(files.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`}>{file.name} ×</Button>)}
    {error && <p role="alert">{error}</p>}
  </div>
}
