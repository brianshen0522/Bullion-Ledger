/**
 * Explains *why* passkeys are unavailable rather than silently hiding the
 * button. The three causes need different user actions, so they get different
 * messages: nothing to do, ask the operator, or switch browser.
 */
export function loginWithPasskeyUnavailable(state: {
  statusResolved: boolean;
  serverSupportsPasskeys: boolean;
  browserSupported: boolean;
}): string | null {
  if (!state.statusResolved) return '正在確認密碼金鑰是否可用…';
  if (!state.serverSupportsPasskeys) {
    return '這個部署尚未設定密碼金鑰。請設定 WEBAUTHN_RP_ID 與 PUBLIC_ORIGIN 後重新啟動 API。';
  }
  if (!state.browserSupported) {
    return '目前的瀏覽器不支援密碼金鑰。請改用 Safari、Chrome 或 Edge 的較新版本。';
  }
  return null;
}
