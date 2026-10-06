// Build the same source/config through Vite's API when native config bundling
// cannot enumerate Windows parent directories in a restricted environment.
import { build } from 'vite'
import { transform } from 'esbuild'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { builtinModules } from 'node:module'

const root = process.cwd()
const generated = resolve('.ai/validation/electron-config.generated.mjs')
await mkdir(resolve('.ai/validation'), { recursive: true })
const source = await readFile(resolve('electron.vite.config.ts'), 'utf8')
const compiled = await transform(source, { loader: 'ts', format: 'esm', target: 'node20' })
await writeFile(generated, `const __dirname = ${JSON.stringify(root)};\n${compiled.code}`)
const config = (await import(pathToFileURL(generated).href)).default
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const external = [...builtinModules, ...builtinModules.map(name => `node:${name}`), 'electron', ...Object.keys(packageJson.dependencies)]
const mainOnly = process.argv.includes('--main-only')
for (const section of mainOnly ? ['main'] : ['main', 'preload']) {
  const original = config[section]
  await build({ ...original, configFile: false, root,
    build: { ...original.build, outDir: resolve(`out/${section}`), emptyOutDir: true, ssr: true, target: 'node20', minify: false,
      rollupOptions: { ...original.build.rollupOptions, external, output: { format: 'cjs', entryFileNames: '[name].js' } } } })
}
if (!mainOnly) await build({ ...config.renderer, configFile: false, base: './', build: { ...config.renderer.build, outDir: resolve('out/renderer'), emptyOutDir: true, target: 'chrome128' } })
