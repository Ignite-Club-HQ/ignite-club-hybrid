export type UpdateDevice = { user: string; platform: string; app_version: [] | [string]; build_number: [] | [string] };
export function targetUpdateRecipients(ids: string[], devices: UpdateDevice[], platform: string, version: string): string[] {
  if (platform === "all" && !version.trim()) return [...new Set(ids)];
  return [...new Set(devices.filter(d => (platform === "all" || d.platform === platform) &&
    (!version.trim() || (d.platform === "android" ? d.build_number[0] : d.app_version[0]) === version.trim()))
    .map(d => d.user).filter(id => ids.includes(id)))];
}