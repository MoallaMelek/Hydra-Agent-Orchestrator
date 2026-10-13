import { FileDiff } from 'lucide-react'
import type { TaskDiff } from '@hydra/protocol'
import { Badge, Callout, EmptyState, Spinner } from '../../design/components'
import { isTestPath, shortSha } from '../../lib/format'

function lineClass(line: string): string {
  if (line.startsWith('@@')) return 'diff-line diff-line--hunk'
  if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git') || line.startsWith('index ')) return 'diff-line diff-line--meta'
  if (line.startsWith('+')) return 'diff-line diff-line--add'
  if (line.startsWith('-')) return 'diff-line diff-line--del'
  return 'diff-line'
}

export function ChangesTab({ diff, error, removed }: { diff: TaskDiff | null; error: string | null; removed: boolean }) {
  if (removed) return <EmptyState icon={<FileDiff size={28} />} title="Workspace removed">The isolated workspace was cleaned up. Applied changes are in your branch's history.</EmptyState>
  if (error) return <Callout tone="warn">{error}</Callout>
  if (!diff) return <div className="row muted"><Spinner /> Loading diff…</div>
  if (!diff.files.length) return <EmptyState icon={<FileDiff size={28} />} title="No changes yet" />
  const add = diff.files.reduce((n, f) => n + f.additions, 0)
  const del = diff.files.reduce((n, f) => n + f.deletions, 0)
  return (
    <div>
      <div className="spread" style={{ marginBottom: 12 }}>
        <span className="muted">{diff.files.length} file{diff.files.length > 1 ? 's' : ''} · <span style={{ color: 'var(--ok)' }}>+{add}</span> <span style={{ color: 'var(--bad)' }}>−{del}</span></span>
        <span className="faint mono" style={{ fontSize: 12 }}>{shortSha(diff.baseSha)} → {shortSha(diff.headSha)}</span>
      </div>
      {diff.truncated && <Callout tone="warn">The diff is large and was truncated for display.</Callout>}
      {diff.files.map((file) => (
        <section key={file.path} className="diff-file">
          <header className="diff-file__head">
            <span className="truncate">{file.oldPath ? `${file.oldPath} → ` : ''}{file.path}</span>
            {isTestPath(file.path) && <Badge tone="info">test</Badge>}
            <Badge tone={file.status === 'added' ? 'ok' : file.status === 'deleted' ? 'bad' : 'neutral'}>{file.status}</Badge>
            <span className="diff-file__stat"><span style={{ color: 'var(--ok)' }}>+{file.additions}</span> <span style={{ color: 'var(--bad)' }}>−{file.deletions}</span></span>
          </header>
          {file.patch ? (
            <pre className="diff-lines">{file.patch.split('\n').filter((l, i) => i > 3 || !/^(diff --git|index |--- |\+\+\+ )/.test(l)).map((line, i) => <span key={i} className={lineClass(line)}>{line || ' '}</span>)}</pre>
          ) : <p className="muted" style={{ padding: 12 }}>{file.status === 'binary' ? 'Binary file' : 'No textual diff'}</p>}
        </section>
      ))}
    </div>
  )
}
