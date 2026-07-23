import { getBrowserApiBaseUrl, requestJson } from "./auth-api";

export interface SocialUser {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
  profileBio: string;
  isSuperAdmin: boolean;
  role: { code: string; name: string; level: number };
  createdAt: string;
}

export interface Friendship {
  id: number;
  status: "pending" | "accepted" | "declined" | "removed";
  direction: "incoming" | "outgoing" | "accepted";
  user: SocialUser;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfile extends SocialUser {
  isSelf: boolean;
  relationship: Pick<Friendship, "id" | "status" | "direction"> | null;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  body: string;
  sender: SocialUser;
  readAt: string | null;
  createdAt: string;
}

export interface Conversation {
  id: number;
  user: SocialUser;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  updatedAt: string;
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export function getPublicProfile(accessToken: string, userId: number): Promise<PublicProfile> {
  return requestJson(`/social/profiles/${userId}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listFriendships(accessToken: string): Promise<{ friends: Friendship[]; incoming: Friendship[]; outgoing: Friendship[] }> {
  return requestJson("/social/friends", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function requestFriend(accessToken: string, userId: number): Promise<Friendship> {
  return requestJson(`/social/friends/${userId}/request`, { method: "POST", headers: authHeaders(accessToken) });
}

export function respondFriendRequest(accessToken: string, friendshipId: number, status: "accepted" | "declined"): Promise<Friendship> {
  return requestJson(`/social/friendships/${friendshipId}/respond`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ status }),
  });
}

export function removeFriendship(accessToken: string, friendshipId: number): Promise<void> {
  return requestJson<void>(`/social/friendships/${friendshipId}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function getSocialSummary(accessToken: string): Promise<{ unreadMessages: number; pendingFriendRequests: number }> {
  return requestJson("/social/summary", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listConversations(accessToken: string): Promise<{ items: Conversation[] }> {
  return requestJson("/social/conversations", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function getOrCreateConversation(accessToken: string, userId: number): Promise<Conversation> {
  return requestJson(`/social/conversations/with/${userId}`, { method: "POST", headers: authHeaders(accessToken) });
}

export function listMessages(accessToken: string, conversationId: number, beforeId?: number): Promise<{ items: ChatMessage[]; hasMore: boolean }> {
  const query = beforeId ? `?beforeId=${beforeId}&limit=30` : "?limit=30";
  return requestJson(`/social/conversations/${conversationId}/messages${query}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function markConversationRead(accessToken: string, conversationId: number): Promise<void> {
  return requestJson<void>(`/social/conversations/${conversationId}/read`, { method: "POST", headers: authHeaders(accessToken) });
}

export function getChatSocketOrigin(): string {
  const apiBase = getBrowserApiBaseUrl();
  return apiBase.endsWith("/api") ? apiBase.slice(0, -4) : apiBase;
}
