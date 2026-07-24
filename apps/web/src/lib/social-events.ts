export const SOCIAL_STATE_CHANGE_EVENT = "hlovet-social-state-change";
export const CHAT_DOCK_OPEN_EVENT = "hlovet-chat-dock-open";
export const CHAT_DOCK_TOGGLE_EVENT = "hlovet-chat-dock-toggle";

export interface ChatDockOpenDetail {
  conversationId?: number;
  userId?: number;
  systemNotificationId?: number;
  tab?: "chats" | "friends";
}

export function notifySocialStateChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SOCIAL_STATE_CHANGE_EVENT));
}

export function openChatDock(detail: ChatDockOpenDetail = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<ChatDockOpenDetail>(CHAT_DOCK_OPEN_EVENT, { detail }));
}

export function toggleChatDock(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHAT_DOCK_TOGGLE_EVENT));
}
