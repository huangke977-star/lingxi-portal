import { getBrowserApiBaseUrl, requestBlob, requestJson } from "./auth-api";

export interface SocialUser {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
  profileBio: string;
  isSuperAdmin: boolean;
  isAdministrator: boolean;
  role: { code: string; name: string; level: number };
  createdAt: string;
}

export interface Friendship {
  id: number;
  status: "pending" | "accepted" | "declined" | "removed" | "blocked";
  direction: "incoming" | "outgoing" | "accepted" | "blocked";
  note: string | null;
  user: SocialUser;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfile extends Omit<SocialUser, "profileBio" | "createdAt"> {
  profileBio: string | null;
  createdAt: string | null;
  isSelf: boolean;
  subscribed: boolean;
  subscriberCount: number | null;
  followingCount: number | null;
  publicArticleCount: number | null;
  receivedLikeCount: number | null;
  publicViewCount: number | null;
  visibleFields: { bio: boolean; joinedAt: boolean; stats: boolean; followingCount: boolean; pinnedContent: boolean };
  relationship: Pick<Friendship, "id" | "status" | "direction" | "note"> | null;
  canRequestFriend: boolean;
  messageAccess: "conversation" | "request" | "none";
}

export interface SocialUserSearchResult extends SocialUser {
  relationship: Pick<Friendship, "id" | "status" | "direction" | "note"> | null;
  canRequest: boolean;
}

export type NotificationChannel = "system" | "subscription" | "interaction";

export interface ChatAttachment {
  id: number;
  conversationId: number;
  kind: "image" | "file" | "audio" | "video";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

export type CallType = "voice" | "video";
export type CallStatus = "ringing" | "accepted" | "declined" | "busy" | "cancelled" | "missed" | "active" | "completed" | "failed";

export interface CallSession {
  id: number;
  conversationId: number;
  type: CallType;
  status: CallStatus;
  callerId: number;
  calleeId: number;
  user: SocialUser;
  acceptedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CallIceConfig {
  iceServers: RTCIceServer[];
  expiresAt: string | null;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  body: string;
  type: "text" | "attachment" | "mixed" | "system";
  attachments: ChatAttachment[];
  call: {
    id: number;
    type: CallType;
    status: CallStatus;
    durationSeconds: number | null;
  } | null;
  sender: SocialUser;
  senderDisplayName: string;
  readAt: string | null;
  createdAt: string;
}

export interface Conversation {
  id: number;
  kind: "direct" | "group" | "temporary";
  user: SocialUser;
  group: ChatGroupSummary | null;
  lastMessage: ChatMessage | null;
  unreadCount: number;
  muted: boolean;
  canCall: boolean;
  updatedAt: string;
}

export interface StrangerMessageRequest {
  id: number;
  user: SocialUser;
  body: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  direction: "incoming" | "outgoing";
  conversationId: number | null;
  respondedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatGroupSummary {
  id: number;
  conversationId: number;
  owner: SocialUser;
  name: string;
  avatarUrl: string | null;
  announcement: string;
  joinMode: "approval" | "invite_only";
  membersCanInvite: boolean;
  memberLimit: number;
  memberCount: number;
  temporary: boolean;
  expiresAt: string | null;
  status: "active" | "dissolved";
  isBanned: boolean;
  bannedUntil: string | null;
  banReason: string | null;
  currentMemberRole: "owner" | "admin" | "member" | null;
  currentAlias: string | null;
  canManage: boolean;
  canModerate: boolean;
  canInvite: boolean;
  pendingJoinRequestCount: number;
  pendingReportCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatGroupMember {
  user: SocialUser;
  role: "owner" | "admin" | "member";
  status: "active" | "left" | "removed" | "blocked";
  alias: string | null;
  mutedUntil: string | null;
  joinedAt: string;
  isSelf: boolean;
}

export interface ChatGroup extends ChatGroupSummary {
  owner: SocialUser;
  members: ChatGroupMember[];
  banRecords: ChatGroupBanRecord[];
}

export interface ChatGroupBanRecord {
  id: number;
  reason: string;
  startsAt: string;
  expiresAt: string | null;
  liftedAt: string | null;
  createdAt: string;
  actor: SocialUser;
  liftedBy: SocialUser | null;
}

export interface ChatGroupApproval {
  invitations: ChatGroupInvitation[];
  joinRequests: Array<ChatGroupJoinRequest & {
    group: Pick<ChatGroupSummary, "id" | "conversationId" | "name" | "avatarUrl">;
  }>;
}

export interface ChatGroupInvitation {
  id: number;
  group: ChatGroupSummary;
  inviter: SocialUser;
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface ChatGroupJoinRequest {
  id: number;
  groupId: number;
  user: SocialUser;
  note: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string;
}

export interface ChatGroupReport {
  id: number;
  group: { id: number; conversationId: number; name: string; avatarUrl: string | null };
  message: ChatMessage;
  reporter: SocialUser;
  reason: string;
  detail: string | null;
  status: "pending" | "resolved" | "rejected";
  resolution: string | null;
  handledAt: string | null;
  createdAt: string;
}

export interface NotificationChannelState {
  channel: NotificationChannel;
  hiddenThroughNotificationId: number;
  pushEnabled: boolean;
}

export interface SocialNotification {
  id: number;
  type:
    | "friend_request_received"
    | "friend_request_accepted"
    | "friend_request_declined"
    | "comment_report_resolved"
    | "comment_report_rejected"
    | "comment_author_moderated"
    | "article_report_received"
    | "article_report_resolved"
    | "article_report_rejected"
    | "article_author_moderated"
    | "article_liked"
    | "article_favorited"
    | "article_commented"
    | "comment_replied"
    | "author_subscribed"
    | "subscription_published"
    | "announcement_published"
    | "suggestion_updated"
    | "system";
  channel: NotificationChannel;
  title: string;
  body: string;
  bodyEn: string | null;
  actionUrl: string | null;
  friendshipId: number | null;
  commentReportId: number | null;
  articleReportId: number | null;
  announcementId: number | null;
  actor: SocialUser | null;
  context: {
    kind: "comment_report" | "article_report" | "article" | "article_comment" | "friend_request" | "stranger_message_request" | "group_invitation" | "group_join_request" | "group_report" | "group_ban" | "announcement";
    announcementId?: number;
    announcement?: { id: number; title: string; summary: string };
    article?: { id: number; title: string; slug: string };
    commentId?: number;
    commentBody?: string;
    commentStatus?: string;
    groupId?: number;
    conversationId?: number;
    invitationId?: number;
    joinRequestId?: number;
    requestId?: number;
    requestBody?: string;
    reportId?: number;
    actionable?: boolean;
    status?: string;
    requestNote?: string | null;
    group?: { id: number; conversationId: number; name: string; avatarUrl: string | null };
    message?: ChatMessage;
  } | null;
  aggregateCount: number;
  readAt: string | null;
  openedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function authHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}` };
}

export function getPublicProfile(accessToken: string, userId: number): Promise<PublicProfile> {
  return requestJson(`/social/profiles/${userId}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function getProfileByUsername(username: string, accessToken?: string | null): Promise<PublicProfile> {
  const path = accessToken ? "/profiles/visible" : "/profiles/public";
  return requestJson(`${path}/${encodeURIComponent(username)}`, {
    cache: "no-store",
    headers: accessToken ? authHeaders(accessToken) : undefined,
  });
}

export function listFriendships(accessToken: string): Promise<{ friends: Friendship[]; incoming: Friendship[]; outgoing: Friendship[]; blocked: Friendship[] }> {
  return requestJson("/social/friends", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function searchSocialUsers(
  accessToken: string,
  query: string,
  limit = 12,
): Promise<{ items: SocialUserSearchResult[] }> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  return requestJson(`/social/users/search?${params}`, {
    cache: "no-store",
    headers: authHeaders(accessToken),
  });
}

export function requestFriend(accessToken: string, userId: number, note?: string): Promise<Friendship> {
  return requestJson(`/social/friends/${userId}/request`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ note }),
  });
}

export function subscribeToAuthor(accessToken: string, userId: number): Promise<{ subscribed: true; subscriberCount: number }> {
  return requestJson(`/social/subscriptions/${userId}`, { method: "POST", headers: authHeaders(accessToken) });
}

export function unsubscribeFromAuthor(accessToken: string, userId: number): Promise<{ subscribed: false; subscriberCount: number }> {
  return requestJson(`/social/subscriptions/${userId}`, { method: "DELETE", headers: authHeaders(accessToken) });
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

export function blockFriendship(accessToken: string, friendshipId: number): Promise<void> {
  return requestJson<void>(`/social/friendships/${friendshipId}/block`, { method: "POST", headers: authHeaders(accessToken) });
}

export function unblockFriendship(accessToken: string, friendshipId: number): Promise<void> {
  return requestJson<void>(`/social/friendships/${friendshipId}/block`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function blockUser(accessToken: string, userId: number): Promise<void> {
  return requestJson<void>(`/social/users/${userId}/block`, { method: "POST", headers: authHeaders(accessToken) });
}

export function listStrangerMessageRequests(accessToken: string): Promise<{ incoming: StrangerMessageRequest[]; outgoing: StrangerMessageRequest[] }> {
  return requestJson("/social/stranger-message-requests", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function createStrangerMessageRequest(accessToken: string, userId: number, body: string): Promise<StrangerMessageRequest> {
  return requestJson(`/social/stranger-message-requests/${userId}`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ body }),
  });
}

export function respondStrangerMessageRequest(
  accessToken: string,
  requestId: number,
  status: "accepted" | "declined",
): Promise<{ request: StrangerMessageRequest; conversation: Conversation | null }> {
  return requestJson(`/social/stranger-message-requests/${requestId}/respond`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ status }),
  });
}

export function getSocialSummary(accessToken: string): Promise<{ unreadMessages: number; pendingFriendRequests: number; pendingStrangerRequests: number; unreadNotifications: number }> {
  return requestJson("/social/summary", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listNotifications(accessToken: string, beforeId?: number, channel?: NotificationChannel): Promise<{ items: SocialNotification[]; hasMore: boolean; hiddenChannels: NotificationChannel[]; channelStates: NotificationChannelState[] }> {
  const params = new URLSearchParams({ limit: "50" });
  if (beforeId) params.set("beforeId", String(beforeId));
  if (channel) params.set("channel", channel);
  const query = `?${params}`;
  return requestJson(`/social/notifications${query}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function hideNotificationChannel(accessToken: string, channel: NotificationChannel): Promise<{ channel: NotificationChannel; hiddenThroughNotificationId: number; readAt: string }> {
  return requestJson(`/social/notification-channels/${channel}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function updateNotificationChannelSettings(
  accessToken: string,
  channel: NotificationChannel,
  input: { pushEnabled: boolean },
): Promise<NotificationChannelState> {
  return requestJson(`/social/notification-channels/${channel}/settings`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(input),
  });
}

export function markNotificationRead(accessToken: string, notificationId: number): Promise<SocialNotification> {
  return requestJson<SocialNotification>(`/social/notifications/${notificationId}/read`, { method: "PATCH", headers: authHeaders(accessToken) });
}

export function markAllNotificationsRead(accessToken: string, channel?: NotificationChannel): Promise<{ count: number; readAt: string }> {
  const query = channel ? `?channel=${channel}` : "";
  return requestJson<{ count: number; readAt: string }>(`/social/notifications/read-all${query}`, { method: "POST", headers: authHeaders(accessToken) });
}

export function markSelectedNotificationsRead(accessToken: string, notificationIds: number[]): Promise<{ count: number; readAt: string }> {
  return requestJson<{ count: number; readAt: string }>("/social/notifications/read-selected", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ notificationIds }),
  });
}

export function deleteNotification(accessToken: string, notificationId: number): Promise<{ count: number }> {
  return requestJson<{ count: number }>(`/social/notifications/${notificationId}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function deleteSelectedNotifications(accessToken: string, notificationIds: number[]): Promise<{ count: number }> {
  return requestJson<{ count: number }>("/social/notifications/delete-selected", {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ notificationIds }),
  });
}

export function clearNotifications(accessToken: string, channel: NotificationChannel): Promise<{ count: number }> {
  return requestJson<{ count: number }>(`/social/notifications?channel=${channel}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function listConversations(accessToken: string): Promise<{ items: Conversation[] }> {
  return requestJson("/social/conversations", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listChatGroups(accessToken: string): Promise<{ items: ChatGroupSummary[]; memberLimit: number }> {
  return requestJson("/social/groups", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listAdminChatGroups(accessToken: string, query = ""): Promise<{ items: ChatGroupSummary[] }> {
  const params = new URLSearchParams({ q: query, limit: "50" });
  return requestJson(`/social/groups/admin?${params}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function searchChatGroups(accessToken: string, query: string): Promise<{ items: ChatGroupSummary[] }> {
  const params = new URLSearchParams({ q: query, limit: "20" });
  return requestJson(`/social/groups/search?${params}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function getChatGroup(accessToken: string, groupId: number): Promise<ChatGroup> {
  return requestJson(`/social/groups/${groupId}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function banChatGroup(accessToken: string, groupId: number, input: { permanent: boolean; durationMinutes?: number; reason: string }): Promise<ChatGroupSummary> {
  return requestJson(`/social/groups/${groupId}/ban`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function liftChatGroupBan(accessToken: string, groupId: number): Promise<ChatGroupSummary> {
  return requestJson(`/social/groups/${groupId}/ban`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function listChatGroupBanRecords(accessToken: string, groupId: number): Promise<{ items: ChatGroupBanRecord[] }> {
  return requestJson(`/social/groups/${groupId}/ban-records`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function createChatGroup(
  accessToken: string,
  input: { name: string; memberIds?: number[]; temporary?: boolean; ttlDays?: number; joinMode?: "approval" | "invite_only" },
): Promise<ChatGroup> {
  return requestJson("/social/groups", { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function updateChatGroup(
  accessToken: string,
  groupId: number,
  input: { name?: string; announcement?: string; joinMode?: "approval" | "invite_only"; membersCanInvite?: boolean; avatarUrl?: string },
): Promise<ChatGroup> {
  return requestJson(`/social/groups/${groupId}`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function uploadChatGroupAvatar(accessToken: string, groupId: number, file: File): Promise<ChatGroup> {
  const body = new FormData();
  body.append("file", file);
  return requestJson(`/social/groups/${groupId}/avatar`, { method: "POST", headers: authHeaders(accessToken), body });
}

export function updateChatGroupAlias(accessToken: string, groupId: number, alias: string): Promise<ChatGroup> {
  return requestJson(`/social/groups/${groupId}/alias`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify({ alias }) });
}

export function inviteChatGroupMembers(accessToken: string, groupId: number, userIds: number[]): Promise<{ count: number }> {
  return requestJson(`/social/groups/${groupId}/invitations`, { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify({ userIds }) });
}

export function listChatGroupInvitations(accessToken: string): Promise<{ items: ChatGroupInvitation[] }> {
  return requestJson("/social/group-invitations", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function listChatGroupApprovals(accessToken: string): Promise<ChatGroupApproval> {
  return requestJson("/social/group-approvals", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function respondChatGroupInvitation(accessToken: string, invitationId: number, status: "accepted" | "declined"): Promise<{ group: ChatGroup | null }> {
  return requestJson(`/social/group-invitations/${invitationId}/respond`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify({ status }) });
}

export function respondChatGroupInvitationByGroup(accessToken: string, groupId: number, status: "accepted" | "declined"): Promise<{ group: ChatGroup | null }> {
  return requestJson(`/social/groups/${groupId}/invitation/respond`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify({ status }) });
}

export function requestChatGroupJoin(accessToken: string, groupId: number, note = ""): Promise<{ status: "joined" | "pending"; id?: number }> {
  return requestJson(`/social/groups/${groupId}/join-requests`, { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify({ note }) });
}

export function listChatGroupJoinRequests(accessToken: string, groupId: number): Promise<{ items: ChatGroupJoinRequest[] }> {
  return requestJson(`/social/groups/${groupId}/join-requests`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function respondChatGroupJoinRequest(accessToken: string, groupId: number, requestId: number, status: "approved" | "rejected"): Promise<{ success: true }> {
  return requestJson(`/social/groups/${groupId}/join-requests/${requestId}`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify({ status }) });
}

export function updateChatGroupMember(accessToken: string, groupId: number, userId: number, input: { role?: "admin" | "member"; mutedMinutes?: number }): Promise<ChatGroup> {
  return requestJson(`/social/groups/${groupId}/members/${userId}`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function removeChatGroupMember(accessToken: string, groupId: number, userId: number): Promise<ChatGroup> {
  return requestJson(`/social/groups/${groupId}/members/${userId}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function blockChatGroupMember(accessToken: string, groupId: number, userId: number): Promise<ChatGroup> {
  return requestJson(`/social/groups/${groupId}/members/${userId}/block`, { method: "POST", headers: authHeaders(accessToken) });
}

export function unblockChatGroupMember(accessToken: string, groupId: number, userId: number): Promise<ChatGroup> {
  return requestJson(`/social/groups/${groupId}/members/${userId}/block`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function transferChatGroupOwner(accessToken: string, groupId: number, userId: number): Promise<ChatGroup> {
  return requestJson(`/social/groups/${groupId}/transfer`, { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify({ userId }) });
}

export function leaveChatGroup(accessToken: string, groupId: number): Promise<{ success: true }> {
  return requestJson(`/social/groups/${groupId}/leave`, { method: "POST", headers: authHeaders(accessToken) });
}

export function dissolveChatGroup(accessToken: string, groupId: number): Promise<{ success: true }> {
  return requestJson(`/social/groups/${groupId}`, { method: "DELETE", headers: authHeaders(accessToken) });
}

export function reportChatGroupMessage(accessToken: string, groupId: number, messageId: number, input: { reason: string; detail?: string }): Promise<{ id: number; status: "pending" }> {
  return requestJson(`/social/groups/${groupId}/messages/${messageId}/reports`, { method: "POST", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function listChatGroupReports(accessToken: string, groupId?: number, status?: ChatGroupReport["status"]): Promise<{ items: ChatGroupReport[] }> {
  const params = new URLSearchParams();
  if (groupId) params.set("groupId", String(groupId));
  if (status) params.set("status", status);
  return requestJson(`/social/group-reports?${params}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function handleChatGroupReport(accessToken: string, reportId: number, input: { status: "resolved" | "rejected"; resolution?: string; deleteMessage?: boolean }): Promise<{ success: true }> {
  return requestJson(`/social/group-reports/${reportId}`, { method: "PATCH", headers: authHeaders(accessToken), body: JSON.stringify(input) });
}

export function getOrCreateConversation(accessToken: string, userId: number): Promise<Conversation> {
  return requestJson(`/social/conversations/with/${userId}`, { method: "POST", headers: authHeaders(accessToken) });
}

export function listMessages(accessToken: string, conversationId: number, beforeId?: number): Promise<{ items: ChatMessage[]; hasMore: boolean }> {
  const query = beforeId ? `?beforeId=${beforeId}&limit=10` : "?limit=10";
  return requestJson(`/social/conversations/${conversationId}/messages${query}`, { cache: "no-store", headers: authHeaders(accessToken) });
}

export function markConversationRead(accessToken: string, conversationId: number): Promise<void> {
  return requestJson<void>(`/social/conversations/${conversationId}/read`, { method: "POST", headers: authHeaders(accessToken) });
}

export function updateConversationSettings(
  accessToken: string,
  conversationId: number,
  input: { muted: boolean },
): Promise<Conversation> {
  return requestJson(`/social/conversations/${conversationId}/settings`, {
    method: "PATCH",
    headers: authHeaders(accessToken),
    body: JSON.stringify(input),
  });
}

export function getCallIceServers(accessToken: string): Promise<CallIceConfig> {
  return requestJson("/social/calls/ice-servers", { cache: "no-store", headers: authHeaders(accessToken) });
}

export function uploadChatAttachments(accessToken: string, conversationId: number, files: File[]): Promise<ChatAttachment[]> {
  const body = new FormData();
  files.forEach((file) => body.append("files", file));
  return requestJson(`/social/conversations/${conversationId}/attachments`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body,
  });
}

export function downloadChatAttachment(accessToken: string, attachment: Pick<ChatAttachment, "downloadUrl">): Promise<Blob> {
  return requestBlob(attachment.downloadUrl, { headers: authHeaders(accessToken), cache: "no-store" });
}

export function downloadChatAttachmentThumbnail(accessToken: string, attachment: Pick<ChatAttachment, "thumbnailUrl">): Promise<Blob> {
  if (!attachment.thumbnailUrl) return Promise.reject(new Error("这张图片没有缩略图。"));
  return requestBlob(attachment.thumbnailUrl, { headers: authHeaders(accessToken), cache: "force-cache" });
}

export function getChatSocketOrigin(): string {
  const apiBase = getBrowserApiBaseUrl();
  return apiBase.endsWith("/api") ? apiBase.slice(0, -4) : apiBase;
}
