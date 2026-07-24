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
  direction: "incoming" | "outgoing" | "accepted";
  note: string | null;
  user: SocialUserResponse;
  createdAt: string;
  updatedAt: string;
}

export interface PublicProfileResponse extends SocialUserResponse {
  isSelf: boolean;
  relationship: Omit<FriendshipResponse, "user" | "createdAt" | "updatedAt"> | null;
}

export interface ChatMessageResponse {
  id: number;
  conversationId: number;
  body: string;
  type: "text" | "attachment" | "mixed" | "system";
  attachments: ChatAttachmentResponse[];
  sender: SocialUserResponse;
  readAt: string | null;
  createdAt: string;
}

export interface ConversationResponse {
  id: number;
  user: SocialUserResponse;
  lastMessage: ChatMessageResponse | null;
  unreadCount: number;
  updatedAt: string;
}

export interface SocialSummaryResponse {
  unreadMessages: number;
  pendingFriendRequests: number;
  unreadNotifications: number;
}

export interface ChatAttachmentResponse {
  id: number;
  conversationId: number;
  kind: "image" | "file";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
  createdAt: string;
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
    | "system";
  title: string;
  body: string;
  actionUrl: string | null;
  friendshipId: number | null;
  commentReportId: number | null;
  actor: SocialUserResponse | null;
  context: {
    kind: "comment_report";
    commentId: number;
    commentBody: string;
    commentStatus: string;
    article: { id: number; title: string; slug: string };
  } | null;
  readAt: string | null;
  createdAt: string;
}
