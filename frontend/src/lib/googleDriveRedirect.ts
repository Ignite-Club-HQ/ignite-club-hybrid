/** Keep native OAuth authorization and exchange on the registered production callback. */
export function googleDriveRedirectUri(native: boolean, browserOrigin: string): string {
  return native ? "https://igniteclubhq.app/vault" : new URL("/vault", browserOrigin).href;
}