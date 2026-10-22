// Builds the design prototypes into design/prototypes/dist (no framework, one bundle per concept).
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('../../', import.meta.url))
const entries = process.argv.slice(2).length ? process.argv.slice(2) : ['a-network', 'b-observatory', 'c-adaptive', 'bench']
for (const name of entries) {
  await build({
    entryPoints: [`${root}design/prototypes/src/${name}.ts`], bundle: true, format: 'iife', target: 'chrome120', minify: false,
    outfile: `${root}design/prototypes/dist/${name}.js`, alias: { '@hydra/protocol': `${root}packages/protocol/src/verification.ts` }, logLevel: 'warning'
  })
  console.log('built', name)
}
