import { tr } from './i18n'

// B376: what to do when this device's protected store cannot be read. macOS keeps the key in the Keychain, which asks
// and can be refused. Windows has no such prompt: safeStorage seals it with the Windows account (DPAPI), and it is lost
// when someone else resets that account's password or the profile is moved to another PC. Each place that tells the
// person says it from here, for the platform it runs on.
export function localKeyUnreadableDetail(platform: string): string {
  return platform === 'win32'
    ? tr('Windows 사용자 계정이 바뀌었다면(다른 사람이 비밀번호를 재설정했거나 다른 PC로 옮긴 경우) 이 기기의 보관 키를 읽지 못할 수 있어요. 새로 시작하면 이 기기에만 있던 기록은 휴지통으로 옮겨지고, 저장된 계정은 다시 연결됩니다.')
    : tr('키체인 접근을 거부했다면 다시 열어 허용해 주세요. 새로 시작하면 이 기기에만 있던 기록은 휴지통으로 옮겨지고, 저장된 계정은 다시 연결됩니다.')
}
export function secureStoreReopenHint(platform: string): string {
  return platform === 'win32' ? tr('Windows에 같은 사용자로 로그인한 뒤 앱을 다시 열어 주세요.') : tr('키체인 접근을 허용한 뒤 앱을 다시 열어 주세요.')
}
