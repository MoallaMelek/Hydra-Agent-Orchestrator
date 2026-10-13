# Remote control protocol (v1)

Goal: control Hydra from a phone with **no cloud database and no third-party service**. A transport (LAN WebSocket today, an owner-hosted relay later) carries only ciphertext. Remote is **off by default** and must be enabled on the desktop.

## Keys
- **Engine identity:** a static X25519 key pair, created on first use and stored in the local database (`kv`). The public key appears in pairing links.
- **Device identity:** a static X25519 key pair generated in the phone browser and stored in its IndexedDB/localStorage. The engine stores only the public key, the name, scopes, `pairedAt`, `expiresAt` (30 days), `lastSeenAt` and `revokedAt`.
- Primitives (via `@noble/*`, audited, pure JS so no secure browser context is needed): X25519, HKDF-SHA256, XChaCha20-Poly1305, SHA-256.

## Pairing (one time per device)
1. The desktop user chooses a name and scopes (`view`, `control`, `approve`). The engine creates `{pairingId, secret (32 random bytes), expiresAt: now + 5 min}`, held in memory only.
2. The QR code / link is `http://<lan-ip>:<port>/remote#p=<base64url(json{v, e: enginePub, i: pairingId, s: secret})>`. The fragment is never sent over the network.
3. The phone generates its device key pair and opens the WebSocket with a **pairing handshake** (below), mixing `secret` into the key schedule. A wrong or expired secret leaves the two sides with different keys, so the first frame fails to decrypt and the connection is closed.
4. On success the engine registers the device and **consumes the pairing** (single use).

## Handshake (every connection)
```
C → S  {t:"hello", v:1, d:<devicePub>, e:<clientEphPub>, p:<pairingId>|null}
S → C  {t:"hello", e:<serverEphPub>}
ikm  = X25519(cEph, S.static) ‖ X25519(D.static, S.static) ‖ X25519(cEph, sEph) ‖ X25519(D.static, sEph)
salt = SHA-256("hydra-remote-v1" ‖ C.hello ‖ S.hello ‖ secret-or-empty)
k_c2s ‖ k_s2c = HKDF-SHA256(ikm, salt, "hydra-remote-v1 keys", 64)
C → S  first encrypted frame: {type:"auth", name?}   (pairing: name requested; session: nothing)
```
- **Mutual authentication.** Only the holder of the device private key and the engine private key derive matching keys. The engine also rejects unknown, revoked or expired devices (unless pairing).
- **Forward secrecy** per connection through the ephemeral keys.
- **Frames:** `{t:"m", n:<counter>, c:<base64url ciphertext>}`. The nonce is the counter encoded into 24 bytes, under per-direction keys. Counters must increase strictly, so replays and reordering are rejected.

## Messages (inside frames)
- Client → server: `{id, kind:"command", command}` · `{id, kind:"query", query:"snapshot"|"task"|"diff", taskId?}`
- Server → client: `{ack:id, ok, result|error}` · `{event: EventEnvelope}` (task, run and evidence events only)
- Commands pass through `Engine.execute` with actor `{kind:"remote", deviceId, scopes}`; `REMOTE_COMMAND_SCOPE` enforces scopes. Results are idempotent per `(deviceId, id)`, and duplicates return the stored ack.
- Reconnection: the client reconnects with backoff, performs a fresh handshake, and requests a snapshot.

## Residual risks
- **The phone UI is served over plain HTTP on the LAN.** An active attacker on the same network could tamper with the JavaScript before it runs, and steal the device key or forge actions. Crypto protects the channel, not the code delivery. Use a trusted network or a VPN (e.g. Tailscale), or the future HTTPS relay. → THREAT_MODEL T20.
- Metadata (timing, sizes) is visible on the network.
- A lost unlocked phone can act until it is revoked or expires. The `approve` scope is opt-in.
