import type {
  ArticleContentFormatValue,
  ArticleCommentStatusValue,
  ArticleStatusValue,
  ArticleVisibilityValue,
} from "./dto/article.dto";

export type ArticleContentFormatResponse = ArticleContentFormatValue;

export interface ArticleAuthorResponse {
  id: number;
  nickname: string;
  username: string;
  avatarUrl: string | null;
  isSuperAdmin: boolean;
  isAdministrator: boolean;
  isDeleted?: boolean;
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
  type: "markdown" | "html" | "resource";
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
  contentFormat: ArticleContentFormatResponse;
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
  schedule: {
    publishAt: string | null;
    unpublishAt: string | null;
    error: string | null;
  };
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

export interface ArticleAttachmentResponse {
  id: number;
  kind: "image" | "file" | "audio" | "video";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

export interface ArticleTemplateResponse {
  id: number;
  name: string;
  title: string;
  summary: string;
  content: string;
  contentFormat: ArticleContentFormatResponse;
  category: string;
  tags: string[];
  titleColor: string;
  visibility: ArticleVisibilityValue;
  roleCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ArticlePublishCheckResponse {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ArticleScheduleListResponse {
  items: Array<{
    id: number;
    title: string;
    slug: string;
    status: ArticleStatusValue;
    publishAt: string | null;
    unpublishAt: string | null;
    error: string | null;
    updatedAt: string;
  }>;
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
  quote: {
    id: number;
    body: string;
    authorName: string;
    createdAt: string;
    available: boolean;
  } | null;
  attachments: ArticleCommentAttachmentResponse[];
  pendingReportCount?: number;
  reports?: ArticleCommentReportResponse[];
  author: ArticleAuthorResponse;
  createdAt: string;
  updatedAt: string;
}

export interface ArticleCommentAttachmentResponse {
  id: number;
  kind: "image" | "file" | "audio" | "video";
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  downloadUrl: string;
  thumbnailUrl: string | null;
  createdAt: string;
}

export interface ArticleCommentReportResponse {
  id: number;
  commentId: number;
  commentBody: string;
  commentStatus: string;
  attachments: ArticleCommentAttachmentResponse[];
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

export interface ArticleMineDashboardResponse {
  views: number;
  likes: number;
  comments: number;
  favorites: number;
  resourceExchanges: number;
  pendingPoints: number;
  settledPoints: number;
  recentResourceIncome: Array<{
    id: number;
    article: { id: number; title: string; slug: string };
    pointCost: number;
    createdAt: string;
    availableAt: string;
    settledAt: string | null;
  }>;
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
  contentFormat: ArticleContentFormatResponse;
  category: string;
  tags: string[];
  titleColor: string;
  visibility: ArticleVisibilityValue;
  status: ArticleStatusValue;
  roleCodes: string[];
  isPointResource: boolean;
  pointCost: number;
}
