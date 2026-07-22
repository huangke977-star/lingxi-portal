import type {
  ArticleCommentStatusValue,
  ArticleStatusValue,
  ArticleVisibilityValue,
} from "./dto/article.dto";

export interface ArticleAuthorResponse {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
}

export interface ArticleRoleResponse {
  code: string;
  name: string;
  level: number;
}

export interface ArticleResponse {
  id: number;
  title: string;
  slug: string;
  summary: string;
  content: string;
  coverPath: string | null;
  category: string;
  tags: string[];
  titleColor: string;
  visibility: ArticleVisibilityValue;
  status: ArticleStatusValue;
  isPinned: boolean;
  pinOrder: number;
  publishedAt: string | null;
  blockedReason: string | null;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  commentCount: number;
  author: ArticleAuthorResponse;
  recentCommenters: ArticleAuthorResponse[];
  allowedRoles: ArticleRoleResponse[];
  images: string[];
  liked: boolean;
  favorited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleCommentResponse {
  id: number;
  articleId: number;
  parentId: number | null;
  body: string;
  status: ArticleCommentStatusValue;
  author: ArticleAuthorResponse;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleListResponse {
  items: ArticleResponse[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ArticleMineSummaryResponse {
  total: number;
  draft: number;
  published: number;
  unpublished: number;
  blocked: number;
  deleted: number;
}

export interface ArticleCenterSummaryResponse {
  discover: number;
  mine: number;
  favorites: number;
  liked: number;
  manage: number;
}

export interface ArticleCommentsResponse {
  items: ArticleCommentResponse[];
}

export interface ArticleInteractionResponse {
  liked?: boolean;
  favorited?: boolean;
  likeCount: number;
  favoriteCount: number;
}
