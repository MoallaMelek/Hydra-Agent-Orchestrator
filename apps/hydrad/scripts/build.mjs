// Bundles hydrad (engine + protocol + ws + zod) into one ESM file for the desktop app.
import { build } from 'esbuild'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))

await build({
  entryPoints: [here('../src/cli.ts')],
  outfile: here('../dist/hydrad.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  conditions: ['source'],
  alias: { '@hydra/engine': here('../../../packages/engine/src/index.ts'), '@hydra/protocol': here('../../../packages/protocol/src/index.ts'), '@hydra/secure-channel': here('../../../packages/secure-channel/src/index.ts') },
  sourcemap: true,
  legalComments: 'linked',
  banner: { js: "import { createRequire as __hydraCreateRequire } from 'node:module'; const require = __hydraCreateRequire(import.meta.url);" },
  // Optional native accelerators of ws (pure-JS fallback is used); koffi has a native binary.
  external: ['bufferutil', 'utf-8-validate', 'koffi']
})

// koffi (Windows job objects) ships beside the bundle with only this platform's binary.
const require = createRequire(import.meta.url)
const out = here('../dist/node_modules')
rmSync(out, { recursive: true, force: true })
let koffiDir = dirname(require.resolve('koffi'))
while (!existsSync(`${koffiDir}/package.json`) || !readFileSync(`${koffiDir}/package.json`, 'utf8').includes('"name": "koffi"')) koffiDir = dirname(koffiDir)
// Documentation is not needed at run time.
cpSync(koffiDir, `${out}/koffi`, { recursive: true, filter: (src) => !src.split(/[/\\]/).includes('doc') })
const native = `@koromix/koffi-${process.platform}-${process.arch}`
try {
  const nativeDir = dirname(createRequire(`${koffiDir}/`).resolve(`${native}/package.json`))
  if (existsSync(nativeDir)) cpSync(nativeDir, `${out}/${native}`, { recursive: true })
} catch { console.warn(`koffi binary for ${process.platform}-${process.arch} not found; job objects will be unavailable`) }
console.log('hydrad bundled → dist/hydrad.mjs')
