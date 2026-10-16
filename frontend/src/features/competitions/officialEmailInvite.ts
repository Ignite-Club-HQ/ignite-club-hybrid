export interface OfficialEmailInviteSecrets {
  token: string;
  code: string;
  emailHash: string;
  codeHash: string;
}

export function createOfficialInviteToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(24)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export function createOfficialInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const value = new DataView(bytes.buffer).getUint32(0, false) % 100_000_000;
  return String(value).padStart(8, "0");
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function hashOfficialInviteEmail(token: string, email: string): Promise<string> {
  return sha256Hex(`${token}:${email.trim().toLowerCase()}`);
}

export function hashOfficialInviteCode(token: string, code: string): Promise<string> {
  return sha256Hex(`${token}:${code}`);
}

export async function createOfficialEmailInviteSecrets(email: string): Promise<OfficialEmailInviteSecrets> {
  const normalizedEmail = email.trim().toLowerCase();
  const token = createOfficialInviteToken();
  const code = createOfficialInviteCode();
  const [emailHash, codeHash] = await Promise.all([
    hashOfficialInviteEmail(token, normalizedEmail),
    hashOfficialInviteCode(token, code),
  ]);
  return { token, code, emailHash, codeHash };
}