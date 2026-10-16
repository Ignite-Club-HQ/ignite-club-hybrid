/** Poll IDs are UUIDs in Supabase and prefixed opaque IDs in ICP. */
export const POLL_TOKEN_PATTERN = String.raw`\[poll:([A-Za-z0-9-]+)\]`;