// One capture group containing the complete ID, for both UUID and ICP events.
export const EVENT_TOKEN_PATTERN = String.raw`\[event:([A-Za-z0-9-]+)\]`;
export const EVENT_URL_PATTERN = String.raw`(?:https?:\/\/[^\s]*)?\/events\/([A-Za-z0-9-]+)(?:[^\s\]]*)?`;