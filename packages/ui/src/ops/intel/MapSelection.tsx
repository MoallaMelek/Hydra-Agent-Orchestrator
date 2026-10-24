import { ArrowRight, X } from 'lucide-react'
import { Button } from '../../design/components'
import { PlainEnglish } from './EvidenceInspector'
import { AiExplanation } from './AiExplanation'
import { explainNode } from './explain'
import type { IntelGraph } from './graph'
import { KIND_NAME } from './text'

/** Under a project map: what the selected mission or file is, in plain English, with a way in. */
export function MapSelection({ graph, selected, projectId, onOpen, onClose }: { graph: IntelGraph; selected: string | null; projectId: string; onOpen: (taskId: string) => void; onClose: () => void }) {
  const n = selected ? graph.byId.get(selected) : undefined
  if (!n) return <p className="map-sel__hint faint">Click a mission or a file on the map to see what it is. Double-click a mission, or press Enter, to open it.</p>
  return <div className="map-sel" role="status" aria-live="polite">
    <div className="map-sel__head">
      <div>
        <p className="eyebrow">{KIND_NAME[n.kind]}</p>
        <h3 className="map-sel__title">{n.kind === 'file' ? n.file!.path : n.label}</h3>
      </div>
      <div className="row">
        {n.kind === 'mission' && <Button size="sm" variant="primary" icon={<ArrowRight size={14} />} onClick={() => onOpen(n.id.slice(5))}>Open mission</Button>}
        <Button size="sm" variant="ghost" aria-label="Close" icon={<X size={14} />} onClick={onClose} />
      </div>
    </div>
    <AiExplanation node={n} graph={graph} projectId={projectId} lens="project" />
    <PlainEnglish x={explainNode(n, graph, 'project')} />
  </div>
}
