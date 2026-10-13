import type { NetworkInterfaceInfo } from 'node:os'
import { describe, expect, it } from 'vitest'
import { defaultRouteAddress, rankAddresses } from './addresses.js'

const v4 = (address: string, mac = 'c4:d6:d3:00:00:01'): NetworkInterfaceInfo => ({ address, family: 'IPv4', internal: false, netmask: '255.255.255.0', mac, cidr: null })

// The owner's Windows machine on 2026-10-13: the WSL adapter came first and was put in the QR code.
const OWNER_PC = {
  'vEthernet (WSL (Hyper-V firewall))': [v4('172.23.128.1', '00:15:5d:62:db:c0')],
  'Ethernet 2': [v4('192.168.56.1', '0a:00:27:00:00:07')], // VirtualBox host-only
  'VMware Network Adapter VMnet8': [v4('192.168.191.1', '00:50:56:c0:00:08')],
  'Connexion au réseau local* 10': [v4('169.254.146.211')],
  Ethernet: [v4('169.254.148.5')],
  'Wi-Fi': [v4('192.168.1.22', '4c:23:38:af:4e:49')],
  'VMware Network Adapter VMnet1': [v4('192.168.202.1', '00:50:56:c0:00:01')],
  'Loopback Pseudo-Interface 1': [{ ...v4('127.0.0.1'), internal: true }]
}

describe('pairing address selection', () => {
  it('puts the Wi-Fi address first on a machine with WSL, VMware and VirtualBox adapters', () => {
    const ranked = rankAddresses(OWNER_PC, null)
    expect(ranked[0]!.address).toBe('192.168.1.22')
    expect(ranked.map((a) => a.address)).not.toContain('169.254.146.211')
    expect(ranked.map((a) => a.address)).not.toContain('127.0.0.1')
    expect(ranked.find((a) => a.address === '172.23.128.1')!.virtual).toBe(true)
  })

  it('prefers the address the system routes through', () => {
    expect(rankAddresses(OWNER_PC, '192.168.56.1')[0]!.address).toBe('192.168.56.1')
  })

  it('finds a default-route address without failing when offline', async () => {
    const found = await defaultRouteAddress()
    expect(found === null || /^\d+\.\d+\.\d+\.\d+$/.test(found)).toBe(true)
  })
})
