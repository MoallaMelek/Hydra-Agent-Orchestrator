import { useEffect, useMemo, useState } from 'react'
import qrcode from 'qrcode-generator'
import { QrCode } from 'lucide-react'
import type { DeviceScope } from '@hydra/protocol'
import { Button, Callout, Field, Panel } from '../design/components'
import { useApp, useAppState } from '../app/context'

interface PairingLink { url: string; expiresAt: string; engineFingerprint: string; host?: string }

/** Creates a single-use, 5-minute pairing link and shows it as a QR code. */
export function PairPhonePanel() {
  const { run, store } = useApp()
  const addresses = useAppState((s) => s.remote?.addresses) ?? []
  const [host, setHost] = useState<string>('')
  const [name, setName] = useState('My phone')
  const [control, setControl] = useState(true)
  const [approve, setApprove] = useState(false)
  const [link, setLink] = useState<PairingLink | null>(null)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!link) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [link])

  const qr = useMemo(() => {
    if (!link) return null
    const code = qrcode(0, 'M')
    code.addData(link.url)
    code.make()
    return code.createDataURL(6, 2)
  }, [link])

  const start = async () => {
    setBusy(true)
    const scopes: DeviceScope[] = ['view', ...(control ? ['control' as const] : []), ...(approve ? ['approve' as const] : [])]
    const ack = await run({ type: 'device.pair_start', name: name.trim(), scopes, ...(host ? { host } : {}) })
    setBusy(false)
    if (ack.ok) setLink(ack.result as PairingLink)
    // Pairing turns phone access on (for an hour) if it was off.
    void store.reload().catch(() => {})
  }

  const left = link ? Math.max(0, Math.round((Date.parse(link.expiresAt) - now) / 1000)) : 0

  return (
    <Panel title="Pair a phone">
      {!link || left === 0 ? (
        <div className="stack">
          <div className="composer__row">
            <Field label="Device name" htmlFor="pair-name"><input id="pair-name" className="hx-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Permissions">
              <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked readOnly disabled /> View tasks</label>
              <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={control} onChange={(e) => setControl(e.target.checked)} /> Start, cancel and resume tasks</label>
              <label className="row" style={{ fontSize: 13 }}><input type="checkbox" checked={approve} onChange={(e) => setApprove(e.target.checked)} /> Approve, reject and roll back</label>
            </Field>
            {addresses.length > 1 && (
              <Field label="Network" htmlFor="pair-host" hint="Pick the address of the network your phone is on (usually Wi-Fi).">
                <select id="pair-host" className="hx-select" value={host || addresses[0]!.address} onChange={(e) => setHost(e.target.value)}>
                  {addresses.map((a) => <option key={a.address} value={a.address}>{a.address} ({a.label})</option>)}
                </select>
              </Field>
            )}
            <div className="col" style={{ justifyContent: 'flex-end' }}>
              <Button variant="primary" icon={<QrCode size={15} />} busy={busy} disabled={!name.trim()} onClick={() => void start()}>Show pairing code</Button>
            </div>
          </div>
          {link && left === 0 && <Callout tone="warn">That pairing code expired. Create a new one.</Callout>}
          <p className="faint" style={{ fontSize: 12 }}>Your phone must be on the same Wi-Fi as this computer (or connected through your own VPN). Showing a pairing code turns phone access on for an hour (on the chosen address, port 47900); if Windows asks, allow it on private networks.</p>
        </div>
      ) : (
        <div className="row" style={{ gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {qr && <img src={qr} alt="Pairing QR code" width={220} height={220} style={{ background: '#fff', borderRadius: 8, padding: 6, imageRendering: 'pixelated' }} />}
          <div className="stack grow" style={{ minWidth: 260 }}>
            <p>Scan with <b>{name}</b>'s camera. The code works once and expires in <b>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</b>.</p>
            <Callout tone="info">The phone will show a check code. It must match: <b className="mono">{link.engineFingerprint}</b></Callout>
            <p className="faint" style={{ fontSize: 12 }}>If the page does not open on the phone: check both are on the same Wi-Fi, then try another address under <b>Network</b>. The phone should open <code style={{ wordBreak: 'break-all' }}>{link.url.split('#')[0]}</code>.</p>
            <div><Button onClick={() => setLink(null)}>Done</Button></div>
          </div>
        </div>
      )}
    </Panel>
  )
}
