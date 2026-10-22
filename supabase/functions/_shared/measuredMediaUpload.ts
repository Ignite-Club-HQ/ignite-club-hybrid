// Existing external HTTP service boundary: raw, bounded bytes only. Never
// issue a browser Storage token or accept declared metadata as measured size.
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

export async function readMeasuredBody(request: Request): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_MEDIA_BYTES)) {
    throw new Error("File must be no larger than 10 MB.");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("File is empty.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_MEDIA_BYTES) {
        await reader.cancel();
        throw new Error("File must be no larger than 10 MB.");
      }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error("File is empty.");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

type MediaServices = {
  authenticate(token: string): Promise<string | null>;
  reserve(input: { user: string; club: string; team: string | null; bucket: string; path: string; bytes: number; vault: boolean }): Promise<string>;
  upload(bucket: string, path: string, bytes: Uint8Array, mime: string): Promise<void>;
  settle(id: string, completed: boolean): Promise<void>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleMeasuredMediaUpload(request: Request, services: MediaServices, cors: Record<string, string>): Promise<Response> {
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return reply({ error: "Sign-in required" }, 401);
  let user: string | null;
  try { user = await services.authenticate(token); } catch { return reply({ error: "Could not verify sign-in" }, 503); }
  if (!user) return reply({ error: "Sign-in required" }, 401);
  const club = request.headers.get("x-media-club") ?? "";
  const team = request.headers.get("x-media-team") || null;
  const bucket = request.headers.get("x-media-bucket") ?? "";
  const path = request.headers.get("x-media-path") ?? "";
  const vault = request.headers.get("x-media-vault") === "true";
  if (!uuid.test(club) || (team && !uuid.test(team)) || !["photos", "chat-attachments", "competition-vault"].includes(bucket) || path.length > 512 || !path.startsWith(`clubs/${club}/`) || /(^|\/)\.{1,2}(\/|$)|[%\\\x00-\x1f]/.test(path)) {
    return reply({ error: "Invalid upload scope" }, 400);
  }
  let bytes: Uint8Array;
  try { bytes = await readMeasuredBody(request); } catch { return reply({ error: "File must contain between 1 byte and 10 MB." }, 413); }
  let reservation: string;
  try { reservation = await services.reserve({ user, club, team, bucket, path, bytes: bytes.byteLength, vault }); }
  catch { return reply({ error: "Upload refused: check your access and available storage." }, 403); }
  // Once a Storage call starts, failure may be an unknown commit. Retain the
  // durable reservation; do not auto-release, delete, or replay the upload.
  try {
    const mime = request.headers.get("content-type") || "application/octet-stream";
    await services.upload(bucket, path, bytes, mime);
    await services.settle(reservation, true);
    return reply({ path, measured_bytes: bytes.byteLength });
  } catch { return reply({ error: "Upload could not be confirmed. Please check your files before trying again." }, 503); }
}