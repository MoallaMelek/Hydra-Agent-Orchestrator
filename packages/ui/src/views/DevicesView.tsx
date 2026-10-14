import { Smartphone } from 'lucide-react'
import { Badge, Button, Callout, EmptyState, Panel } from '../design/components'
import { useApp } from '../app/context'
import { ago } from '../lib/format'
import { PairPhonePanel } from './PairPhonePanel'
import { PhoneAccessPanel } from './PhoneAccessPanel'

/** Paired phones: pair, inspect and revoke. */
export function DevicesView() {
  const { state, run } = useApp()
  const devices = [...state.devices].sort((a, b) => b.pairedAt.localeCompare(a.pairedAt))
  return (
    <div className="page">
      <div className="page__head"><div className="page__title"><h1>Remote devices</h1><p className="muted">Phones that can follow tasks and, if you allow it, approve them.</p></div></div>
      <Callout tone="info">Remote control is end-to-end encrypted between your phone and this computer. No cloud database or third-party service is involved.</Callout>
      <PhoneAccessPanel />
      <PairPhonePanel />
      <Panel title="Paired devices">
        {devices.length === 0 ? <EmptyState icon={<Smartphone size={28} />} title="No paired devices" /> : devices.map((d) => {
          const revoked = Boolean(d.revokedAt)
          const expired = !revoked && Date.parse(d.expiresAt) < Date.now()
          return (
            <div key={d.id} className="spread" style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div>
                <b>{d.name}</b>
                <div className="faint" style={{ fontSize: 12 }}>Paired {ago(d.pairedAt)} · {d.lastSeenAt ? `seen ${ago(d.lastSeenAt)}` : 'never connected'} · {d.scopes.join(', ')}</div>
              </div>
              <div className="row">
                <Badge tone={revoked ? 'neutral' : expired ? 'warn' : 'ok'}>{revoked ? 'Revoked' : expired ? 'Expired' : 'Active'}</Badge>
                {!revoked && <Button variant="danger" size="sm" onClick={() => void run({ type: 'device.revoke', deviceId: d.id }, 'Device revoked')}>Revoke</Button>}
              </div>
            </div>
          )
        })}
      </Panel>
    </div>
  )
}
