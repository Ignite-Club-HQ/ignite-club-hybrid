// Keep the current live upload path until the external byte receiver has been
// deployed, authenticated readback has passed and restrictive Storage write
// policies are ready for the same release. Never enable this from browser
// storage, a URL parameter, or user-editable settings.
export const MEASURED_MEDIA_UPLOAD_ENABLED = false;