export interface DiscoveryAuthorResponse {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  isAdministrator: boolean;
  role: { code: string; name: string; level: number };
}

export interface UploadedTopicCover {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

export type UploadedCollectionCover = UploadedTopicCover;

export interface DiscoveryTaxonomyLink {
  id: number;
  label: string;
  href: string;
}

export interface DiscoveryArticleResponse {
  id: number;
  title: string;
  slug: string;
  category: string;
  tags: string[];
  titleColor: string;
  coverPath: string | null;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
  publishedAt: string | null;
  author: DiscoveryAuthorResponse;
  collections: DiscoveryTaxonomyLink[];
  topics: DiscoveryTaxonomyLink[];
}

export interface ResourceCatalogItemResponse {
  article: DiscoveryArticleResponse;
  minimumPointCost: number;
  blockCount: number;
  exchangeCount: number;
}

export interface ResourceCatalogResponse {
  items: ResourceCatalogItemResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ResourceCatalogSummaryResponse {
  purchasedBlocks: number;
  soldBlocks: number;
  pendingPoints: number;
}

export interface OnboardingResponse {
  completed: boolean;
  topics: Array<{
    id: number;
    title: string;
    slug: string;
    description: string;
    coverPath: string | null;
    articleCount: number;
    subscriberCount: number;
    subscribed: boolean;
  }>;
  authors: Array<{
    id: number;
    nickname: string;
    username: string;
    avatarUrl: string | null;
    topCategory: string;
    subscribed: boolean;
  }>;
}

export interface SubscriptionFeedResponse {
  items: Array<{ article: DiscoveryArticleResponse; readAt: string | null }>;
  total: number;
  unread: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ArticleCollectionResponse {
  id: number;
  name: string;
  description: string;
  coverPath: string | null;
  visibility: "public" | "authenticated" | "private";
  sortOrder: number;
  owner: DiscoveryAuthorResponse;
  articles: DiscoveryArticleResponse[];
  articleCount: number;
  subscriberCount: number;
  subscribed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleTopicResponse {
  id: number;
  title: string;
  slug: string;
  description: string;
  coverPath: string | null;
  visibility: "public" | "authenticated" | "role_restricted";
  status: "active" | "disabled";
  sortOrder: number;
  roleCodes: string[];
  articles: DiscoveryArticleResponse[];
  articleCount: number;
  subscriberCount: number;
  subscribed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryGroupRecommendation {
  id: number;
  conversationId: number;
  name: string;
  avatarUrl: string | null;
  announcement: string;
  memberCount: number;
  joinMode: "approval" | "invite_only";
  isMember: boolean;
  updatedAt: string;
}

export interface DiscoveryRecommendationsResponse {
  topics: Array<{ id: number; title: string; slug: string; description: string; coverPath: string | null; articleCount: number; subscriberCount: number; subscribed: boolean; updatedAt: string }>;
  collections: Array<{ id: number; name: string; description: string; articleCount: number; subscriberCount: number; subscribed: boolean; owner: DiscoveryAuthorResponse; updatedAt: string }>;
  groups: DiscoveryGroupRecommendation[];
}

export interface ProfileSettingsResponse {
  profileAccess: "public" | "authenticated" | "friends" | "private";
  searchable: boolean;
  friendRequestPolicy: "everyone" | "none";
  directMessagePolicy: "everyone" | "request" | "friends" | "none";
  groupInvitationPolicy: "everyone" | "friends" | "none";
  showBio: boolean;
  showJoinedAt: boolean;
  showStats: boolean;
  showFollowingCount: boolean;
  showPinnedContent: boolean;
  pinnedArticleId: number | null;
  pinnedCollectionId: number | null;
}

export interface ProfileShowcaseResponse {
  settings: ProfileSettingsResponse;
  visitCount: number | null;
  pinnedArticle: DiscoveryArticleResponse | null;
  pinnedCollection: ArticleCollectionResponse | null;
  collections: ArticleCollectionResponse[];
}
