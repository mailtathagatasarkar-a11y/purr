import { shell, systemPreferences } from 'electron'
import type { PermissionStatus } from '../shared/types'

export function permissionStatus(keyboardHook: boolean, helper: boolean): PermissionStatus {
  const platform = process.platform
  let microphone: PermissionStatus['microphone'] = 'unknown'
  try {
    if (platform === 'darwin' || platform === 'win32') microphone = systemPreferences.getMediaAccessStatus('microphone') as PermissionStatus['microphone']
  } catch {
    // ignore
  }
  const accessibility = platform === 'darwin' ? systemPreferences.isTrustedAccessibilityClient(false) : true
  return { platform, microphone, accessibility, keyboardHook, helper }
}

export async function requestPermission(kind: 'microphone' | 'accessibility' | 'input'): Promise<void> {
  if (process.platform === 'darwin') {
    if (kind === 'microphone') {
      const ok = await systemPreferences.askForMediaAccess('microphone')
      if (!ok) await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
    } else if (kind === 'accessibility') {
      if (!systemPreferences.isTrustedAccessibilityClient(true)) {
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
      }
    } else {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent')
    }
  } else if (process.platform === 'win32' && kind === 'microphone') {
    await shell.openExternal('ms-settings:privacy-microphone')
  }
}
