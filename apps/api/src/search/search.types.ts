export interface SearchUserResult {
  id: number;
  username: string;
  nickname: string;
  avatarUrl: string | null;
  profileBio: string;
  isSuperAdmin: boolean;
  isAdministrator: boolean;
  role: { code: string; name: string; level: number };
  createdAt: string;
}

export interface SearchArticleResult {
  id: number;
  title: string;
  slug: string;
  category: string;
  tags: string[];
  publishedAt: string | null;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
  author: Pick<SearchUserResult, "id" | "username" | "nickname" | "avatarUrl" | "isSuperAdmin" | "isAdministrator" | "role">;
}

export interface SearchEntryResult {
  id: number;
  title: string;
  description: string;
  url: string | null;
  iconPath: string | null;
  openInNewTab: boolean;
  category: { id: number; name: string; slug: string; kind: "navigation" | "tool" | "custom_page" };
}

export interface SearchTopicResult {
  id: number;
  title: string;
  slug: string;
  description: string;
  coverPath: string | null;
  articleCount: number;
  subscriberCount: number;
  updatedAt: string;
}

export interface SearchCollectionResult {
  id: number;
  name: string;
  description: string;
  articleCount: number;
  subscriberCount: number;
  owner: Pick<SearchUserResult, "id" | "username" | "nickname" | "avatarUrl">;
  updatedAt: string;
}

export interface SearchChatGroupResult {
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

export interface SearchAnnouncementResult {
  id: number;
  title: string;
  summary: string;
  isPinned: boolean;
  publishedAt: string | null;
  expiresAt: string | null;
}

export interface SearchCategoryFilter {
  name: string;
  value: string;
}

export interface SearchGroup<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface GlobalSearchResponse {
  query: string;
  sort: "relevance" | "latest" | "popular";
  articles: SearchGroup<SearchArticleResult>;
  users: SearchGroup<SearchUserResult>;
  navigation: SearchGroup<SearchEntryResult>;
  tools: SearchGroup<SearchEntryResult>;
  topics: SearchGroup<SearchTopicResult>;
  collections: SearchGroup<SearchCollectionResult>;
  groups: SearchGroup<SearchChatGroupResult>;
  announcements: SearchGroup<SearchAnnouncementResult>;
  filters: {
    articleCategories: SearchCategoryFilter[];
    navigationCategories: SearchCategoryFilter[];
    toolCategories: SearchCategoryFilter[];
  };
}

export interface SearchHistoryResponse {
  id: number;
  keyword: string;
  searchCount: number;
  lastSearchedAt: string;
}

export interface HotSearchResponse {
  keyword: string;
  searchCount: number;
}
