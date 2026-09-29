import { invoke, isTauri } from '@tauri-apps/api/core'

export const platform = { mobile: false, platform: 'browser' }
export async function initializePlatform() {
  Object.assign(
    platform,
    isTauri()
      ? await invoke<typeof platform>('platform_info')
      : { mobile: new URLSearchParams(location.search).get('mobile') === '1', platform: 'browser' },
  )
  document.documentElement.dataset.platform = platform.mobile ? 'mobile' : 'desktop'
}
export async function openExternalUrl(url: string) {
  if (platform.mobile && isTauri()) await invoke('open_external_url', { url })
  else window.open(url, '_blank', 'noopener,noreferrer')
}
