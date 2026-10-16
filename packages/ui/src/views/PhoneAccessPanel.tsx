import { useEffect, useState } from 'react'
import { ShieldAlert, Wifi, WifiOff } from 'lucide-react'
import { Badge, Button, Callout, Field, Panel } from '../design/components'
import { useApp, useAppState } from '../app/context'

const DURATIONS = [{ minutes: 60, label: '1 hour' }, { minutes: 8 * 60, label: '8 hours' }, { minutes: 0, label: 'Until Hydra closes' }]

/**
 * Phone access is off by default and turned on here for a limited time. The phone page
 * travels over plain HTTP on the local network, so exposure is kept short and visible.
 */
export function PhoneAccessPanel() {
  const { run, store } = useApp()
  const remote = useAppState((s) => s.remote)
  const addresses = remote?.addresses ?? []
  const [host, setHost] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)
  useEffect(() => { void store.reload().catch(() => {}) }, [store])
  // Keep the "until" time and the off-switch at expiry current on screen.
  useEffect(() => {
    if (!remote?.enabled) return
    const timer = setInterval(() => { tick((n) => n + 1); if (remote.until && Date.parse(remote.until) <= Date.now()) void store.reload() }, 15_000)
    return () => clearInterval(timer)
  }, [remote?.enabled, remote?.until, store])

  const act = async (command: Record<string, unknown>, done: string) => {
    setBusy(true)
    await run(command, done)
    await store.reload().catch(() => {})
    setBusy(false)
  }

  const on = Boolean(remote?.enabled)
  return (
    <Panel title="Phone access" actions={<Badge tone={on ? 'warn' : 'neutral'}>{on ? 'On' : 'Off'}</Badge>}>
      {on ? (
        <div className="stack">
          <p className="row"><Wifi size={16} aria-hidden /> Phones on your network can reach Hydra at <code>{remote?.host}</code>{remote?.until ? <> until <b>{new Date(remote.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b></> : ' until Hydra closes'}.</p>
          <div className="row"><Button busy={busy} icon={<WifiOff size={15} />} onClick={() => void act({ type: 'remote.disable' }, 'Phone access turned off')}>Turn off now</Button></div>
        </div>
      ) : (
        <div className="stack">
          <p className="muted">Off. Paired phones cannot connect until you turn it on. It turns itself off when the time is up, and is always off when Hydra starts.</p>
          <div className="composer__row">
            <Field label="For" htmlFor="access-for">
              <select id="access-for" className="hx-select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
                {DURATIONS.map((d) => <option key={d.minutes} value={d.minutes}>{d.label}</option>)}
              </select>
            </Field>
            {addresses.length > 1 && (
              <Field label="Network" htmlFor="access-host" hint="Only this address is opened, usually your Wi-Fi.">
                <select id="access-host" className="hx-select" value={host || addresses[0]!.address} onChange={(e) => setHost(e.target.value)}>
                  {addresses.map((a) => <option key={a.address} value={a.address}>{a.address} ({a.label})</option>)}
                </select>
              </Field>
            )}
            <div className="col" style={{ justifyContent: 'flex-end' }}>
              <Button variant="primary" busy={busy} icon={<Wifi size={15} />} onClick={() => void act({ type: 'remote.enable', minutes, ...(host ? { host } : {}) }, 'Phone access turned on')}>Turn on</Button>
            </div>
          </div>
        </div>
      )}
      <Callout tone="warn" icon={<ShieldAlert size={16} />}>
        Use phone access only on networks you trust (home, or your own VPN such as Tailscale). Messages are end-to-end encrypted, but the phone page itself is sent without HTTPS, so someone controlling the network could tamper with it. Avoid public Wi-Fi.
      </Callout>
    </Panel>
  )
}
