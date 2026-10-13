import { createSocket } from 'node:dgram'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

export interface LanAddress {
  address: string
  /** Operating-system interface name, e.g. "Wi-Fi" or "en0". */
  interface: string
  /** Virtual adapters (WSL, Hyper-V, VMware, Docker…) are usually unreachable from a phone. */
  virtual: boolean
}

const VIRTUAL = /vethernet|hyper-v|wsl|vmware|vmnet|virtualbox|vbox|docker|podman|veth|^br-|bridge|utun|loopback|npcap|zerotier|hamachi/i
/** MAC prefixes of virtual adapters: VirtualBox, VMware, Hyper-V/WSL, Parallels, QEMU/KVM, Xen, Docker. */
const VIRTUAL_MAC = /^(0a:00:27|08:00:27|00:50:56|00:0c:29|00:05:69|00:1c:14|00:15:5d|00:1c:42|52:54:00|00:16:3e|02:42)/i
const PHYSICAL = /wi-?fi|wlan|wireless|ethernet|^en\d|^eth\d|^wl/i

/**
 * The local address the operating system would use to reach the internet.
 * A UDP "connect" only selects a route; no packet is sent.
 */
export function defaultRouteAddress(timeoutMs = 500): Promise<string | null> {
  return new Promise((resolve) => {
    const socket = createSocket('udp4')
    const finish = (value: string | null) => { clearTimeout(timer); try { socket.close() } catch { /* already closed */ } resolve(value) }
    const timer = setTimeout(() => finish(null), timeoutMs)
    socket.on('error', () => finish(null))
    try {
      socket.connect(53, '192.0.2.1', () => { try { finish(socket.address().address) } catch { finish(null) } })
    } catch { finish(null) }
  })
}

/** Ranks this computer's IPv4 addresses by how likely a phone on the same network can reach them. */
export function rankAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, preferred: string | null): LanAddress[] {
  const found: LanAddress[] = []
  for (const [name, list] of Object.entries(interfaces)) {
    for (const entry of list ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.')) continue
      found.push({ address: entry.address, interface: name, virtual: VIRTUAL.test(name) || VIRTUAL_MAC.test(entry.mac) })
    }
  }
  const score = (a: LanAddress) => (a.address === preferred ? 0 : 10) + (a.virtual ? 5 : 0) + (PHYSICAL.test(a.interface) ? 0 : 1)
  return found.sort((a, b) => score(a) - score(b))
}

export async function lanAddresses(): Promise<LanAddress[]> {
  return rankAddresses(networkInterfaces(), await defaultRouteAddress())
}
