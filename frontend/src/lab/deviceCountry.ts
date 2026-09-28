export function detectDeviceCountry(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const locale = navigator.languages?.[0] ?? navigator.language;
  const region = locale?.match(/[-_]([A-Za-z]{2})$/)?.[1];
  return region?.toUpperCase();
}
