import { createRoot } from "react-dom/client";
import { ChatPageSkeleton } from "@/components/chat/ChatPageSkeleton";
import { getChatThreadLabel, rememberChatThreadLabel } from "@/lib/chatThreadLabelCache";

/** Temporary browser-verification seam: paints the real loading header. */
export function paintDemo() {
  rememberChatThreadLabel("demo-user", "dm", "demo-dm", { title: "Jane Parent" });
  const label = getChatThreadLabel("demo-user", "dm", "demo-dm");
  const host = document.createElement("div");
  host.setAttribute("data-demo", "chat-skeleton");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#fff";
  document.body.appendChild(host);
  createRoot(host).render(<ChatPageSkeleton title={label?.title} avatarUrl={label?.avatarUrl} avatarType="dm" />);
  return label;
}
