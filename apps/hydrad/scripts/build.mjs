// Bundles hydrad (engine + protocol + ws + zod) into one ESM file for the desktop app.
import { build } from 'esbuild'
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
  sourcemap: true,
  legalComments: 'linked',
  banner: { js: "import { createRequire as __hydraCreateRequire } from 'node:module'; const require = __hydraCreateRequire(import.meta.url);" },
  // Optional native accelerators of ws; the pure-JS fallback is used.
  external: ['bufferutil', 'utf-8-validate']
})
console.log('hydrad bundled → dist/hydrad.mjs')
