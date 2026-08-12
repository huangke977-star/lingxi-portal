export interface SocialUserResponse {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
  profileBio: string;
  isSuperAdmin: boolean;
  role: {
    code: string;
    name: string;
    level: number;
  };
  createdAt: string;
}

export interface FriendshipResponse {
  id: number;
  status: string;
  direction: "incoming" | "outgoing" | "accepted" | "blocked";
  note: string | null;
  user: SocialUserResponse;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfileResponse extends Omit<SocialUserResponse, "profileBio" | "createdAt"> {
  profileBio: string | null;
  createdAt: string | null;
  isSelf: boolean;
  subscribed: boolean;
  subscriberCount: number | null;
  followingCount: number | null;
  publicArticleCount: number | null;
  receivedLikeCount: number | null;
  publicViewCount: number | null;
  visibleFields: {
    bio: boolean;
    joinedAt: boolean;
    stats: boolean;
    followingCount: boolean;
    pinnedContent: boolean;
  };
  relationship: Omit<FriendshipResponse, "user" | "createdAt" | "updatedAt"> | null;
}

export interface SocialUserSearchResult extends SocialUserResponse {
  relationship: Omit<FriendshipResponse, "user" | "createdAt" | "updatedAt"> | null;
  canRequest: boolean;
}

export interface ChatMessageResponse {
  id: number;
  conversationId: number;
  body: string;
  type: "text" | "attachment" | "mixed" | "system";
  attachments: ChatAttachmentResponse[];
  call: {
    id: number;
    type: "voice" | "video";
    status: "ringing" | "accepted" | "declined" | "busy" | "cancelled" | "missed" | "active" | "completed" | "failed";
    durationSeconds: number | null;
  } | null;
  sender: SocialUserResponse;
  senderDisplayName: string;
  readAt: string | null;
  createdAt: string;
}

export interface ConversationResponse {
  id: number;
  kind: "direct" | "group" | "temporary";
  user: SocialUserResponse;
  group: ChatGroupSummaryResponse | null;
  lastMessage: ChatMessageResponse | null;
  unreadCount: number;
  muted: boolean;
  updatedAt: string;
}

export interface ChatGroupMemberResponse {
  user: SocialUserResponse;
  role: "owner" | "admin" | "member";
  status: "active" | "left" | "removed" | "blocked";
  alias: string | null;
  mutedUntil: string | null;
  joinedAt: string;
  isSelf: boolean;
}

export interface ChatGroupSummaryResponse {
  id: number;
  conversationId: number;
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
  currentMemberRole: "owner" | "admin" | "member" | null;
  currentAlias: string | null;
  canManage: boolean;
  canInvite: boolean;
  pendingJoinRequestCount: number;
  pendingReportCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatGroupResponse extends ChatGroupSummaryResponse {
  owner: SocialUserResponse;
  members: ChatGroupMemberResponse[];
}

export interface ChatGroupApprovalResponse {
  invitations: ChatGroupInvitationResponse[];
  joinRequests: Array<ChatGroupJoinRequestResponse & {
    group: Pick<ChatGroupSummaryResponse, "id" | "conversationId" | "name" | "avatarUrl">;
  }>;
}

export interface ChatGroupInvitationResponse {
  id: number;
  group: ChatGroupSummaryResponse;
  inviter: SocialUserResponse;
  status: "pending" | "accepted" | "declined" | "cancelled" | "expired";
  expiresAt: string;
  createdAt: string;
}

export interface ChatGroupJoinRequestResponse {
  id: number;
  groupId: number;
  user: SocialUserResponse;
  note: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  createdAt: string;
}

export interface ChatGroupReportResponse {
  id: number;
  group: Pick<ChatGroupSummaryResponse, "id" | "conversationId" | "name" | "avatarUrl">;
  message: ChatMessageResponse;
  reporter: SocialUserResponse;
  reason: string;
  detail: string | null;
  status: "pending" | "resolved" | "rejected";
  resolution: string | null;
  handledAt: string | null;
  createdAt: string;
}

export interface SocialSummaryResponse {
  unreadMessages: number;
  pendingFriendRequests: number;
  unreadNotifications: number;
}

export interface ChatAttachmentResponse {
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

export interface CallSessionResponse {
  id: number;
  conversationId: number;
  type: "voice" | "video";
  status: "ringing" | "accepted" | "declined" | "busy" | "cancelled" | "missed" | "active" | "completed" | "failed";
  callerId: number;
  calleeId: number;
  user: SocialUserResponse;
  acceptedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface IceServerConfigResponse {
  iceServers: Array<{
    urls: string[];
    username?: string;
    credential?: string;
  }>;
  expiresAt: string | null;
}

export interface UserNotificationResponse {
  id: number;
  type:
    | "friend_request_received"
    | "friend_request_accepted"
    | "friend_request_declined"
    | "comment_report_resolved"
    | "comment_report_rejected"
    | "comment_author_moderated"
    | "article_liked"
    | "article_favorited"
    | "article_commented"
    | "comment_replied"
    | "author_subscribed"
    | "subscription_published"
    | "system";
  channel: "system" | "subscription" | "interaction";
  title: string;
  body: string;
  actionUrl: string | null;
  friendshipId: number | null;
  commentReportId: number | null;
  actor: SocialUserResponse | null;
  context: {
    kind: "comment_report" | "article" | "article_comment" | "friend_request" | "group_invitation" | "group_join_request" | "group_report";
    article?: { id: number; title: string; slug: string };
    commentId?: number;
    commentBody?: string;
    commentStatus?: string;
    groupId?: number;
    conversationId?: number;
    invitationId?: number;
    joinRequestId?: number;
    reportId?: number;
    actionable?: boolean;
    status?: string;
    requestNote?: string | null;
    group?: Pick<ChatGroupSummaryResponse, "id" | "conversationId" | "name" | "avatarUrl">;
    message?: ChatMessageResponse;
  } | null;
  aggregateCount: number;
  readAt: string | null;
  openedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationChannelStateResponse {
  channel: "system" | "subscription" | "interaction";
  hiddenThroughNotificationId: number;
  pushEnabled: boolean;
}
