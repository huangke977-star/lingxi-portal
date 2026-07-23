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
}
