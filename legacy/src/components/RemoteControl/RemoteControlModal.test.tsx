// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RemoteControlState } from '@shared/types'
import { RemoteControlModal } from './RemoteControlModal'

const { toCanvasMock, writeTextMock } = vi.hoisted(() => ({
  toCanvasMock: vi.fn(),
  writeTextMock: vi.fn()
}))

vi.mock('qrcode', () => ({
  toCanvas: toCanvasMock
}))

const baseState: RemoteControlState = {
  enabled: true,
  status: 'active',
  sessionId: 'session-12345678',
  qrPayload: 'https://remote.example.test/#token=test-token',
  connectedAt: null,
  expiresAt: new Date('2026-02-28T23:59:00.000Z').toISOString(),
  mobileConnected: false,
  error: null
}

function renderModal(state: RemoteControlState = baseState) {
  return render(
    <RemoteControlModal
      state={state}
      loading={false}
      onEnable={() => undefined}
      onDisable={() => undefined}
      onClose={() => undefined}
    />
  )
}

describe('RemoteControlModal', () => {
  beforeEach(() => {
    toCanvasMock.mockReset()
    writeTextMock.mockReset()
    writeTextMock.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows a loading indicator while generating QR canvas', async () => {
    let resolveRender!: () => void
    const pending = new Promise<void>((resolve) => {
      resolveRender = () => resolve()
    })
    toCanvasMock.mockReturnValueOnce(pending)

    renderModal()

    await waitFor(() => {
      expect(toCanvasMock).toHaveBeenCalledWith(
        expect.any(HTMLCanvasElement),
        baseState.qrPayload,
        expect.objectContaining({ width: 468, margin: 4, errorCorrectionLevel: 'M' })
      )
    })

    expect(screen.getByText('Generating QR code...')).toBeTruthy()

    resolveRender()

    await waitFor(() => {
      expect(screen.queryByText('Generating QR code...')).toBeNull()
      const canvas = screen.getByLabelText('Remote control QR code') as HTMLCanvasElement
      expect(canvas.style.width).toBe('400px')
      expect(canvas.style.height).toBe('400px')
    })
  })

  it('shows retry and copy-link actions when QR render fails', async () => {
    toCanvasMock.mockRejectedValueOnce(new Error('render failed'))

    renderModal()

    await waitFor(() => {
      expect(
        screen.getByText(/Could not render QR image/)
      ).toBeTruthy()
    })

    expect(screen.getByRole('button', { name: 'Regenerate QR' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy mobile link' })).toBeTruthy()
  })

  it('copies the HTTPS mobile link', async () => {
    toCanvasMock.mockResolvedValueOnce(undefined)
    renderModal()

    fireEvent.click(screen.getByRole('button', { name: 'Copy mobile link' }))

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(baseState.qrPayload)
      expect(screen.getByText('Mobile link copied')).toBeTruthy()
    })
  })

  it('shows immediate loading feedback while enabling remote control', () => {
    render(
      <RemoteControlModal
        state={{ ...baseState, enabled: false, status: 'disconnected', qrPayload: null }}
        loading={true}
        onEnable={() => undefined}
        onDisable={() => undefined}
        onClose={() => undefined}
      />
    )

    expect(screen.getByText('Enabling remote control...')).toBeTruthy()
  })

  it('waits for active state before attempting QR render', async () => {
    toCanvasMock.mockResolvedValueOnce(undefined)

    const creatingState: RemoteControlState = {
      ...baseState,
      status: 'creating'
    }

    const { rerender } = render(
      <RemoteControlModal
        state={creatingState}
        loading={false}
        onEnable={() => undefined}
        onDisable={() => undefined}
        onClose={() => undefined}
      />
    )

    expect(toCanvasMock).not.toHaveBeenCalled()

    rerender(
      <RemoteControlModal
        state={baseState}
        loading={false}
        onEnable={() => undefined}
        onDisable={() => undefined}
        onClose={() => undefined}
      />
    )

    await waitFor(() => {
      expect(toCanvasMock).toHaveBeenCalledTimes(1)
    })
  })

  it('hides enable action while creating to avoid mixed states', () => {
    render(
      <RemoteControlModal
        state={{ ...baseState, enabled: false, status: 'creating', qrPayload: null }}
        loading={false}
        onEnable={() => undefined}
        onDisable={() => undefined}
        onClose={() => undefined}
      />
    )

    expect(screen.queryByRole('button', { name: 'Enable Remote Control' })).toBeNull()
    expect(screen.getByText('Creating session...')).toBeTruthy()
  })
})
