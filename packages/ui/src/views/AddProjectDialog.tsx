import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { Project } from '@hydra/protocol'
import { Button, Dialog, Field } from '../design/components'
import { useApp } from '../app/context'

export function AddProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { run, go, host } = useApp()
  const [root, setRoot] = useState('')
  const [busy, setBusy] = useState(false)

  const browse = async () => {
    const picked = await host.pickDirectory?.()
    if (picked) setRoot(picked)
  }

  const submit = async () => {
    setBusy(true)
    const ack = await run({ type: 'project.add', root: root.trim() }, 'Project added')
    setBusy(false)
    if (ack.ok) {
      onClose()
      setRoot('')
      go({ view: 'project', projectId: (ack.result as Project).id })
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add a project"
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} disabled={!root.trim()} onClick={() => void submit()}>Add project</Button></>}>
      <Field label="Project folder" htmlFor="project-root" hint="Change tasks need a git repository with at least one commit. Home folders, drive roots and system folders are refused.">
        <div className="row">
          <input id="project-root" className="hx-input mono" placeholder={navigator.platform.startsWith('Win') ? 'C:\\code\\my-app' : '/home/me/code/my-app'} value={root}
            onChange={(e) => setRoot(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && root.trim()) void submit() }} autoFocus />
          {host.pickDirectory && <Button icon={<FolderOpen size={15} />} onClick={() => void browse()}>Browse</Button>}
        </div>
      </Field>
    </Dialog>
  )
}
