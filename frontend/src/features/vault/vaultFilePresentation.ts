export interface VaultExternalLinkInfo {
  type: string;
  icon: string;
  color: string;
}

export function formatVaultFileSize(bytes: number | null | undefined): string {
  if (!bytes) return "";
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

export function isVaultSpreadsheetFile(fileName: string): boolean {
  const spreadsheetExtensions = [".xlsx", ".xls", ".csv", ".ods", ".tsv"];
  const lowerName = fileName.toLowerCase();
  return spreadsheetExtensions.some((extension) => lowerName.endsWith(extension));
}

export function isVaultDocumentFile(fileName: string): boolean {
  const documentExtensions = [".doc", ".docx", ".pdf", ".txt", ".rtf", ".odt", ".ppt", ".pptx", ".odp"];
  const lowerName = fileName.toLowerCase();
  return documentExtensions.some((extension) => lowerName.endsWith(extension));
}

export function getVaultExternalLinkInfo(url: string): VaultExternalLinkInfo {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes("docs.google.com/document")) {
    return { type: "Google Doc", icon: "📄", color: "text-blue-600" };
  }
  if (lowerUrl.includes("docs.google.com/spreadsheets")) {
    return { type: "Google Sheet", icon: "📊", color: "text-green-600" };
  }
  if (lowerUrl.includes("docs.google.com/presentation")) {
    return { type: "Google Slides", icon: "📽️", color: "text-yellow-600" };
  }
  if (lowerUrl.includes("drive.google.com")) {
    return { type: "Google Drive", icon: "📁", color: "text-blue-500" };
  }
  if (lowerUrl.includes("dropbox.com")) {
    return { type: "Dropbox", icon: "📦", color: "text-blue-500" };
  }
  if (lowerUrl.includes("notion.so") || lowerUrl.includes("notion.site")) {
    return { type: "Notion", icon: "📝", color: "text-foreground" };
  }
  if (lowerUrl.includes("onedrive.live.com") || lowerUrl.includes("sharepoint.com")) {
    return { type: "OneDrive", icon: "☁️", color: "text-blue-600" };
  }

  return { type: "External Link", icon: "🔗", color: "text-muted-foreground" };
}
