import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface Preferences { theme: string; quality?: string; drafts: Record<string, { text: string; attachments: Array<{ name: string; content: string }>; routing?: string; mode?: string }> }
const EMPTY: Preferences = { theme: 'dark', drafts: {} }
export function validatePreferences(input: unknown): Preferences {
  if (!input || typeof input !== 'object' || JSON.stringify(input).length > 2_000_000) throw new Error('Invalid interface preferences')
  const value = input as Preferences
  if (value.quality && !['auto', 'full', 'reduced', 'minimal'].includes(value.quality)) throw new Error('Invalid display quality')
  if (!['dark', 'light', 'terracotta'].includes(value.theme) || !value.drafts || typeof value.drafts !== 'object' || Object.keys(value.drafts).length > 100) throw new Error('Invalid interface preferences')
  for (const draft of Object.values(value.drafts)) {
    if (typeof draft.text !== 'string' || draft.text.length > 50000 || !Array.isArray(draft.attachments) || draft.attachments.length > 8) throw new Error('Invalid draft')
    if ((draft.routing && !['auto', 'fast', 'standard', 'deep'].includes(draft.routing)) || (draft.mode && !['safe', 'developer', 'autonomous'].includes(draft.mode))) throw new Error('Invalid draft routing')
    for (const file of draft.attachments) if (typeof file.name !== 'string' || file.name.length > 200 || typeof file.content !== 'string' || file.content.length > 16000) throw new Error('Invalid attachment')
  }
  return value
}
export class PreferenceStore {
  private readonly path: string
  constructor(dir: string) { this.path = join(dir, 'interface-preferences.json') }
  read(): Preferences {
    if (!existsSync(this.path)) return EMPTY
    return validatePreferences(JSON.parse(readFileSync(this.path, 'utf8')))
  }
  write(input: unknown): void {
    const value = validatePreferences(input)
    writeFileSync(this.path + '.tmp', JSON.stringify(value), { mode: 0o600 })
    renameSync(this.path + '.tmp', this.path)
  }
}
