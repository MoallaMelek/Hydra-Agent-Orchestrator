// Bundles the Electron main and preload scripts (CommonJS, as sandboxed preloads require).
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], sourcemap: true, legalComments: 'linked' }

await build({ ...common, entryPoints: [here('../src/main.ts')], outfile: here('../dist/main.cjs') })
await build({ ...common, entryPoints: [here('../src/preload.ts')], outfile: here('../dist/preload.cjs') })
console.log('desktop shell bundled → dist/main.cjs, dist/preload.cjs')
