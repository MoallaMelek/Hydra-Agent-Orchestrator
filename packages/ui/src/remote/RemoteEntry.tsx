import { useEffect, useState } from 'react'
import { decodeOffer, fingerprint, fromHex, generateKeyPair, toHex } from '@hydra/secure-channel'
import { HydraMark } from '../brand/HydraMark'
import { Button, Callout, Field } from '../design/components'
import { EngineStore } from '../api/store'
import { forgetCredentials, loadCredentials, RemoteTransport, saveCredentials, type RemoteCredentials } from '../api/remote'
import { AppProvider } from '../app/context'
import { Shell } from '../app/Shell'

type Stage = { kind: 'pair'; offer: ReturnType<typeof decodeOffer> } | { kind: 'connecting' } | { kind: 'ready'; store: EngineStore } | { kind: 'error'; message: string } | { kind: 'unpaired' }

/**
 * Phone entry point. Pairs once from the QR link, then reconnects by device key.
 * The pairing secret lives only in the URL fragment and is removed immediately.
 */
export function RemoteEntry() {
  const [stage, setStage] = useState<Stage>(() => {
    const fragment = new URLSearchParams(window.location.hash.slice(1)).get('p')
    if (fragment) {
      history.replaceState(null, '', window.location.pathname)
      try { return { kind: 'pair', offer: decodeOffer(fragment) } } catch (error) { return { kind: 'error', message: (error as Error).message } }
    }
    return loadCredentials() ? { kind: 'connecting' } : { kind: 'unpaired' }
  })
  const [name, setName] = useState(() => (/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Android/.test(navigator.userAgent) ? 'Android phone' : 'Phone'))
  const [busy, setBusy] = useState(false)

  const open = async (credentials: RemoteCredentials, pairing: { id: string; secret: Uint8Array } | null) => {
    const transport = new RemoteTransport(window.location.origin, credentials, pairing)
    await transport.connect()
    saveCredentials(credentials)
    const store = new EngineStore(transport)
    await store.start()
    setStage({ kind: 'ready', store })
  }

  useEffect(() => {
    if (stage.kind !== 'connecting') return
    const credentials = loadCredentials()!
    open(credentials, null).catch((error: Error) => setStage({ kind: 'error', message: error.message }))
  }, [stage.kind])

  if (stage.kind === 'ready') {
    return <AppProvider store={stage.store} host={{}}><Shell /></AppProvider>
  }

  const frame = (children: React.ReactNode) => (
    <div className="page" style={{ maxWidth: 440, paddingTop: 48 }}>
      <div className="col" style={{ alignItems: 'center', gap: 12, textAlign: 'center' }}><HydraMark size={44} /><h2>Hydra Remote</h2></div>
      {children}
    </div>
  )

  if (stage.kind === 'pair') {
    const code = fingerprint(fromHex(stage.offer.e))
    return frame(
      <div className="stack">
        <Callout tone="info">Check that this code matches the one on your desktop before pairing: <b className="mono">{code}</b></Callout>
        <Field label="Name this phone" htmlFor="device-name"><input id="device-name" className="hx-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></Field>
        <Button variant="primary" size="lg" busy={busy} disabled={!name.trim()} onClick={() => {
          setBusy(true)
          const device = generateKeyPair()
          open({ deviceSecret: toHex(device.secretKey), enginePub: stage.offer.e, deviceName: name.trim() }, { id: stage.offer.i, secret: fromHex(stage.offer.s) })
            .catch((error: Error) => { setBusy(false); setStage({ kind: 'error', message: error.message }) })
        }}>Pair this phone</Button>
        <p className="faint" style={{ fontSize: 12 }}>Messages between this phone and your computer are end-to-end encrypted. No cloud service is involved. Use this on a network you trust.</p>
      </div>
    )
  }
  if (stage.kind === 'connecting') return frame(<p className="muted" style={{ textAlign: 'center' }}>Connecting to your Hydra…</p>)
  if (stage.kind === 'unpaired') return frame(<Callout tone="info">Open <b>Remote devices → Pair a phone</b> in Hydra on your computer and scan the code.</Callout>)
  return frame(
    <div className="stack">
      <Callout tone="bad">{stage.message}</Callout>
      <Button onClick={() => setStage(loadCredentials() ? { kind: 'connecting' } : { kind: 'unpaired' })}>Try again</Button>
      {loadCredentials() && <Button variant="ghost" onClick={() => { forgetCredentials(); setStage({ kind: 'unpaired' }) }}>Forget this pairing</Button>}
    </div>
  )
}
