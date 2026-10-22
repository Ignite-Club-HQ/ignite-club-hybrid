// Enabled 22 Oct 2026 together with the restrictive storage.objects INSERT/UPDATE
// policies that refuse direct browser writes to clubs/* in photos,
// chat-attachments and competition-vault. Never enable/disable this from
// browser storage, a URL parameter, or user-editable settings.
export const MEASURED_MEDIA_UPLOAD_ENABLED = true;
