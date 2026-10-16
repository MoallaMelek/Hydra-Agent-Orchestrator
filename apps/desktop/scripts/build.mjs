// Bundles the Electron main and preload scripts (CommonJS, as sandboxed preloads require).
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const manifestUrl = process.env.HYDRA_UPDATE_URL || null
const publicKeyHex = process.env.HYDRA_UPDATE_KEY || null
if (publicKeyHex && !/^[0-9a-f]{64}$/.test(publicKeyHex)) throw new Error('Invalid update public key')
if (manifestUrl && !/^https:\/\/github\.com\/MoallaMelek\/Hydra-Agent-Orchestrator\/releases\//.test(manifestUrl)) throw new Error('Update source must be an HTTPS release in the Hydra repository')
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], define: { __HYDRA_UPDATE_CONFIG__: JSON.stringify({ manifestUrl, publicKeyHex }) }, sourcemap: true, legalComments: 'linked' }

await build({ ...common, entryPoints: [here('../src/main.ts')], outfile: here('../dist/main.cjs') })
await build({ ...common, entryPoints: [here('../src/preload.ts')], outfile: here('../dist/preload.cjs') })
console.log('desktop shell bundled → dist/main.cjs, dist/preload.cjs')
