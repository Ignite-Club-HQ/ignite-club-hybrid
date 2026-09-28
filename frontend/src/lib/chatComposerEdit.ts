export type EditableChatMessage = {
  id: string;
  text: string;
};

export const beginChatMessageEdit = <T extends EditableChatMessage>(message: T) => ({
  editingMessage: message,
  composerText: message.text,
});

export const cancelChatMessageEdit = () => ({
  editingMessage: null,
  composerText: "",
} as const);

export const buildChatMessageEdit = (
  editingMessage: EditableChatMessage | null,
  composerText: string,
) => editingMessage
  ? { messageId: editingMessage.id, text: composerText.trim() }
  : null;
