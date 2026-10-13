export function getRemoteAppUrl(): string {
  const configured =
    process.env.HYDRA_REMOTE_APP_URL?.trim() ||
    process.env.MAIN_VITE_HYDRA_REMOTE_APP_URL?.trim()
  if (!configured) {
    throw new Error('Hydra Remote app URL is not configured. Set HYDRA_REMOTE_APP_URL.')
  }
  const url = new URL(configured)

  if (url.protocol !== 'https:') {
    throw new Error('Hydra Remote app URL must use HTTPS.')
  }

  url.hash = ''
  url.search = ''
  return url.toString()
}

export function createMobileLink(mobileToken: string): string {
  const url = new URL(getRemoteAppUrl())
  url.hash = new URLSearchParams({ token: mobileToken }).toString()
  return url.toString()
}
