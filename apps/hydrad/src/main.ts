import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Engine } from '@hydra/engine'
import { startApiServer } from './server.js'

export const VERSION = '2.0.0-alpha.0'

export function defaultDataDir(): string {
  if (process.env.HYDRA_DATA_DIR) return process.env.HYDRA_DATA_DIR
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Hydra', 'v2')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Hydra', 'v2')
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share'), 'hydra', 'v2')
}

interface Args { dataDir: string; port: number; staticDir?: string; printToken: boolean }

function parseArgs(argv: string[]): Args {
  const args: Args = { dataDir: defaultDataDir(), port: 0, printToken: false }
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1]
    switch (argv[i]) {
      case '--data-dir': args.dataDir = value!; i++; break
      case '--port': args.port = Number(value); i++; break
      case '--static': args.staticDir = value; i++; break
      case '--print-token': args.printToken = true; break
      default: break
    }
  }
  return args
}

/**
 * Starts the engine and API. The API token comes from HYDRA_API_TOKEN (set by the
 * desktop shell) or is generated. A single JSON "ready" line is written to stdout
 * so a supervising process can discover the port.
 */
export async function serve(argv = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv)
  const token = process.env.HYDRA_API_TOKEN || randomBytes(32).toString('base64url')
  delete process.env.HYDRA_API_TOKEN // never inherited by agents or checks
  const engine = await Engine.open({ dataDir: args.dataDir, version: VERSION })
  const server = await startApiServer({ engine, token, staticDir: args.staticDir, port: args.port })

  const backupTimer = setInterval(() => { try { engine.backup() } catch { /* reported on next start */ } }, 24 * 60 * 60 * 1000)
  backupTimer.unref()
  try { engine.backup() } catch { /* first start on a read-only volume */ }

  process.stdout.write(`${JSON.stringify({ type: 'ready', port: server.port, url: server.url, dataDir: args.dataDir, ...(args.printToken ? { token } : {}) })}\n`)

  let stopping = false
  const stop = async () => {
    if (stopping) return
    stopping = true
    await server.close()
    await engine.close()
    process.exit(0)
  }
  process.on('SIGINT', () => void stop())
  process.on('SIGTERM', () => void stop())
  process.on('disconnect', () => void stop()) // parent shell went away
  process.stdin.on('end', () => void stop())
}
