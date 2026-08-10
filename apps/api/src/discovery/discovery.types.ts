export interface DiscoveryAuthorResponse {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  role: { code: string; name: string; level: number };
}

export interface UploadedTopicCover {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

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
  visibility: "public" | "authenticated" | "private";
  sortOrder: number;
  owner: DiscoveryAuthorResponse;
  articles: DiscoveryArticleResponse[];
  articleCount: number;
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
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSettingsResponse {
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
