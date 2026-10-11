/** Download authorized, decrypted bytes with the document's original name. */
export async function downloadResolvedFile(url: string, fileName: string, mimeType?: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download file (${response.status})`);
  const original = await response.blob();
  const blob = mimeType?.includes("/") ? new Blob([original], { type: mimeType }) : original;
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

export async function downloadStoredFile(url: string, fileName: string, mimeType?: string): Promise<void> {
  const { resolveSignedUrl } = await import("@/hooks/useSignedPhotoUrl");
  const resolvedUrl = await resolveSignedUrl(url);
  await downloadResolvedFile(resolvedUrl, fileName, mimeType);
}