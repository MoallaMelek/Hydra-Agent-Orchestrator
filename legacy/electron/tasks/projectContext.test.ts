import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFileSync } from 'child_process'
import { collectProjectContext } from './projectContext'

describe('diff-aware project context', () => {
  it('prioritizes tracked changes, deletions and untracked files while excluding secrets', async () => {
    const root = mkdtempSync(join(tmpdir(),'hydra-context-test-'))
    const git = (args:string[]) => execFileSync('git',args,{cwd:root,stdio:'ignore',windowsHide:true})
    try {
      git(['init','-q'])
      for (let i=0;i<260;i++) writeFileSync(join(root,`a-${String(i).padStart(3,'0')}.ts`),'export const unchanged = true')
      writeFileSync(join(root,'zzz-feature.ts'),'export const feature = 1')
      writeFileSync(join(root,'deleted.ts'),'export const removed = true')
      git(['add','.']);git(['-c','user.name=Hydra Fixture','-c','user.email=fixture@local','commit','-qm','fixture'])
      writeFileSync(join(root,'zzz-feature.ts'),'export const feature = 2')
      writeFileSync(join(root,'new-file.ts'),'export const added = true')
      writeFileSync(join(root,'.env'),'FAKE_SECRET=must-never-enter-context')
      unlinkSync(join(root,'deleted.ts'))
      const result=await collectProjectContext(root)
      expect(result.changedFiles).toContain('zzz-feature.ts');expect(result.changedFiles).toContain('deleted.ts');expect(result.changedFiles).toContain('new-file.ts')
      expect(result.snapshot).toContain('feature = 2');expect(result.snapshot).toContain('deleted file mode');expect(result.snapshot).toContain('added = true')
      expect(result.snapshot).not.toContain('must-never-enter-context');expect(result.omissions.some(v=>v.includes('.env'))).toBe(true)
      const before=result.fingerprint;writeFileSync(join(root,'zzz-feature.ts'),'export const feature = 3');expect((await collectProjectContext(root)).fingerprint).not.toBe(before)
    } finally { if(!root.startsWith(join(tmpdir(),'hydra-context-test-')))throw new Error('Invalid cleanup');rmSync(root,{recursive:true,force:true}) }
  }, 20000)
})
