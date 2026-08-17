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
  isSuperAdmin: boolean;
  role: ArticleRoleResponse;
}

export interface ArticleRoleResponse {
  code: string;
  name: string;
  level: number;
}

export interface ArticleGroupingResponse {
  id: number;
  label: string;
  href: string;
}

export interface ArticleContentSegmentResponse {
  type: "markdown" | "resource";
  content?: string;
  key?: string;
  pointCost?: number;
  unlocked?: boolean;
}

export interface ArticleResponse {
  id: number;
  title: string;
  slug: string;
  summary: string;
  content: string;
  contentSegments: ArticleContentSegmentResponse[];
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
  resource: {
    enabled: boolean;
    blocks: Array<{ key: string; pointCost: number; unlocked: boolean }>;
  };
  author: ArticleAuthorResponse;
  recentCommenters: ArticleAuthorResponse[];
  allowedRoles: ArticleRoleResponse[];
  collections: ArticleGroupingResponse[];
  topics: ArticleGroupingResponse[];
  images: string[];
  liked: boolean;
  favorited: boolean;
  readLater: boolean;
  readingProgress: number | null;
  lastReadAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleCommentResponse {
  id: number;
  articleId: number;
  parentId: number | null;
  body: string;
  status: ArticleCommentStatusValue;
  likeCount: number;
  liked: boolean;
  reported: boolean;
  pendingReportCount?: number;
  reports?: ArticleCommentReportResponse[];
  author: ArticleAuthorResponse;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleCommentReportResponse {
  id: number;
  commentId: number;
  commentBody: string;
  commentStatus: string;
  article: {
    id: number;
    title: string;
    slug: string;
  };
  reporter: ArticleAuthorResponse;
  reason: string;
  detail: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
  handledAt: string | null;
}

export interface ArticleCommentReportSummaryResponse {
  pending: number;
}

export interface ArticleReportResponse {
  id: number;
  publicationNumber: number;
  article: { id: number; title: string; slug: string };
  reporter: ArticleAuthorResponse;
  reason: string;
  detail: string | null;
  status: string;
  resolution: string | null;
  createdAt: string;
  handledAt: string | null;
}

export interface ArticleAppealResponse {
  id: number;
  article: { id: number; title: string; slug: string; status: ArticleStatusValue };
  author: ArticleAuthorResponse;
  reason: string;
  status: string;
  resolution: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface ViolationAuthorResponse {
  user: ArticleAuthorResponse;
  totalReceived: number;
  recentReceived: number;
  totalSubmitted: number;
  recentSubmitted: number;
  restriction: {
    id: number;
    reason: string;
    startsAt: string;
    endsAt: string | null;
    liftedAt: string | null;
  } | null;
}

export interface ArticleReportSummaryResponse {
  pending: number;
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
  subscriptions: number;
  mine: number;
  favorites: number;
  liked: number;
  readLater: number;
  history: number;
  manage: number;
}

export interface ArticleCommentsResponse {
  items: ArticleCommentResponse[];
  hasMore: boolean;
  nextCursor: number | null;
  totalThreads: number;
}

export interface ArticleInteractionResponse {
  liked?: boolean;
  favorited?: boolean;
  readLater?: boolean;
  likeCount: number;
  favoriteCount: number;
}

export interface ReadingProgressResponse {
  progress: number;
  lastReadAt: string;
}

export interface ArticleReadLaterResponse {
  readLater: boolean;
}

export interface ArticleVersionSummaryResponse {
  id: number;
  versionNumber: number;
  source: "autosave" | "manual" | "publish" | "restore";
  changedFields: string[];
  editor: { id: number; username: string; nickname: string } | null;
  createdAt: string;
}

export interface ArticleVersionResponse extends ArticleVersionSummaryResponse {
  title: string;
  summary: string;
  content: string;
  category: string;
  tags: string[];
  titleColor: string;
  visibility: ArticleVisibilityValue;
  status: ArticleStatusValue;
  roleCodes: string[];
  isPointResource: boolean;
  pointCost: number;
}
