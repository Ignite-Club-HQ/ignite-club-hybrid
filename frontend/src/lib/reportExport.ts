import { Capacitor } from "@capacitor/core";

const loadOptionalNativeModule = (specifier: string) =>
  new Function("moduleName", "return import(moduleName)")(specifier) as Promise<any>;

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80) || "report";
}

/**
 * Write a text report (HTML/CSV) to the native cache directory, then hand it to
 * the OS. Downloads via blob anchors do not work inside the native WebView.
 */
async function writeTextFileNative(content: string, fileName: string): Promise<string> {
  const { Filesystem, Directory, Encoding } = await import("@capacitor/filesystem");

  const safeName = `report-${Date.now()}-${sanitizeFileName(fileName)}`;
  const written = await Filesystem.writeFile({
    path: safeName,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  });
  const uri =
    written.uri ||
    (await Filesystem.getUri({ path: safeName, directory: Directory.Cache })).uri;
  if (!uri) throw new Error("Report write produced no local path");
  return uri;
}

async function openTextFileNative(content: string, fileName: string, mimeType: string): Promise<void> {
  const { FileOpener } = await loadOptionalNativeModule("@capacitor-community/file-opener");
  const uri = await writeTextFileNative(content, fileName);

  await FileOpener.open({
    filePath: uri,
    // FileOpener needs a bare MIME type; charset params confuse the Android chooser.
    contentType: mimeType.split(";")[0].trim(),
    openWithDefault: true,
  });
}

/**
 * Share a generated file with the OS share sheet (Save to Files, Drive, email…).
 * Preferred for spreadsheets: "open with" pickers offer irrelevant apps.
 */
async function shareTextFileNative(content: string, fileName: string, mimeType: string): Promise<void> {
  const { Share } = await import("@capacitor/share");
  const uri = await writeTextFileNative(content, fileName);
  try {
    await Share.share({ title: fileName, files: [uri] });
  } catch (err) {
    const message = String((err as Error)?.message ?? err).toLowerCase();
    // User dismissing the sheet is not a failure.
    if (message.includes("cancel") || message.includes("abort")) return;
    await openTextFileNative(content, fileName, mimeType);
  }
}


/**
 * Open an HTML report.
 * - Native: writes to cache and opens the default HTML viewer (from there the
 *   user can print/save as PDF/share).
 * - Web: opens a print window. Returns "popup_blocked" if the popup failed.
 */
export async function openHtmlReport(
  html: string,
  fileName: string,
): Promise<"opened" | "popup_blocked"> {
  if (Capacitor.isNativePlatform()) {
    await openTextFileNative(
      html,
      fileName.endsWith(".html") ? fileName : `${fileName}.html`,
      "text/html",
    );
    return "opened";
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) return "popup_blocked";
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  // Wait for images to load before printing.
  setTimeout(() => printWindow.print(), 500);
  return "opened";
}

/**
 * Download a text report (e.g. CSV).
 * - Native: writes to cache and offers the OS share sheet (Save to Files/Drive).
 * - Web: blob + anchor download.
 */
export async function downloadTextReport(
  content: string,
  fileName: string,
  mimeType: string,
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await shareTextFileNative(content, fileName, mimeType);
    return;
  }
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
