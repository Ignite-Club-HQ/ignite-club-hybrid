/** Only acknowledged canister messages may become delivered rows. */
export function liveMessageRow(message: {
  id: string; conversation_id: string; body: string; sender: { toText(): string };
  created_at_ms: bigint; reply_to_id: [] | [string]; attachment: [] | [{ kind: string; url: [] | [string] }];
}) {
  if (!message.id || !message.conversation_id) throw new Error("Missing acknowledged message identity");
  const attachment = message.attachment[0];
  return {
    id: message.id, text: message.body, author_id: message.sender.toText(),
    conversation_id: message.conversation_id, created_at: new Date(Number(message.created_at_ms)).toISOString(),
    reply_to_id: message.reply_to_id[0] ?? null,
    image_url: attachment?.kind === "image" ? attachment.url[0] ?? null : null,
  };
}