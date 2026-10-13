import { serve } from './main.js'

serve().catch((error: unknown) => {
  process.stderr.write(`hydrad failed to start: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
