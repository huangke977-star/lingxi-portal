import type { Locale } from "./i18n";
import type { ReputationReason } from "./reputation-api";

type LocalizedPair = readonly [chinese: string, english: string];

function pick(locale: Locale, value: LocalizedPair): string {
  return value[locale === "en-US" ? 1 : 0];
}

const reputationReasons: Record<ReputationReason, LocalizedPair> = {
  article_read: ["阅读文章", "Read an article"],
  article_comment: ["发布文章评论", "Post an article comment"],
  article_publish: ["首次发布文章", "First article publication"],
  article_liked: ["文章获得点赞", "Article received a like"],
  author_subscribed: ["获得新的订阅者", "Received a new subscriber"],
  resource_redeemed: ["兑换文章资源", "Redeemed article resource"],
  resource_sold: ["文章资源兑换待入账", "Article resource redemption pending"],
  article_report_accepted: ["举报文章被采纳", "Article report accepted"],
};

const auditTargets: Record<string, LocalizedPair> = {
  user: ["用户账号管理", "User account management"],
  portal_content: ["门户内容管理", "Portal content management"],
  article_content: ["文章与评论管理", "Article and comment management"],
  announcement: ["运营公告管理", "Announcement management"],
  operation_analytics: ["运营数据聚合", "Operations analytics"],
  moderation: ["内容治理管理", "Content moderation"],
  group_report: ["群聊举报管理", "Group report management"],
  redis_cache: ["Redis 缓存管理", "Redis cache management"],
  site_setting: ["站点设置管理", "Site settings management"],
  account_security: ["账号安全管理", "Account security management"],
  background: ["站点背景管理", "Site background management"],
  android_release: ["安装包管理", "Package management"],
  database_backup: ["数据库备份操作", "Database backup"],
};

const auditOperations: Record<string, LocalizedPair> = {
  create: ["新增/执行", "Created or executed"],
  update: ["修改", "Updated"],
  delete: ["删除", "Deleted"],
  download: ["下载", "Downloaded"],
};

const analyticsDefinitions: Record<string, LocalizedPair> = {
  newUsers: ["新增用户", "New users"],
  activeUsers: ["活跃用户", "Active users"],
  articles: ["发布文章", "Published articles"],
  comments: ["评论", "Comments"],
  messages: ["聊天消息", "Chat messages"],
  views: ["文章阅读", "Article views"],
  likes: ["点赞", "Likes"],
  favorites: ["收藏", "Favorites"],
  subscriptions: ["订阅增长", "Subscription growth"],
  reports: ["举报", "Reports"],
  disabledUsers: ["封禁", "Disabled accounts"],
  loginRisks: ["登录风险", "Sign-in risks"],
  failedJobs: ["异常任务", "Failed jobs"],
  anonymousTopics: ["匿名话题", "Anonymous topics"],
  anonymousMessages: ["匿名发言", "Anonymous messages"],
  anonymousLikes: ["点评获赞", "Message likes"],
  anonymousFavorites: ["话题喜欢", "Topic favorites"],
  notifications: ["通知创建", "Notifications created"],
  notificationReads: ["通知已读", "Notifications read"],
  notificationOpens: ["通知打开", "Notifications opened"],
  onboardingCompleted: ["兴趣指引完成", "Interest onboarding completed"],
  resourceExchanges: ["资源兑换", "Resource unlocks"],
  resourcePointsSpent: ["资源兑换积分", "Resource points spent"],
  resourcePointsPending: ["资源待入账积分", "Pending resource points"],
  resourcePointsSettled: ["资源已到账积分", "Settled resource points"],
};

const analyticsDefinitionDetails: Record<string, LocalizedPair> = {
  newUsers: ["当天完成注册并写入用户表的账号数量。", "Accounts that completed registration on that day."],
  activeUsers: ["当天发生登录、文章阅读、评论或发送聊天消息的去重账号。", "Distinct accounts that signed in, read, commented, or sent a chat message that day."],
  articles: ["当天首次进入已发布状态的文章数量。", "Articles that entered the published state for the first time that day."],
  comments: ["当天新建的文章评论和回复数量。", "Article comments and replies created that day."],
  messages: ["当天发送的私聊、群聊和通知会话消息数量。", "Direct, group, and notification conversation messages sent that day."],
  views: ["当天产生的文章阅读记录数量。", "Article view records created that day."],
  likes: ["当天新增的文章点赞记录数量。", "Article likes added that day."],
  favorites: ["当天新增的文章收藏记录数量。", "Article favorites added that day."],
  subscriptions: ["当天新增的作者订阅关系数量。", "New author subscriptions created that day."],
  reports: ["当天新建的文章、评论和群消息举报总数。", "Article, comment, and group-message reports created that day."],
  disabledUsers: ["当天被更新为停用状态的账号数量。", "Accounts changed to disabled that day."],
  loginRisks: ["当天记录的中风险和高风险登录安全事件。", "Medium- and high-risk sign-in security events recorded that day."],
  failedJobs: ["当天失败的邮件、存储扫描、媒体备份和运营后台任务总数。", "Failed mail, storage scan, media backup, and operations jobs that day."],
  anonymousTopics: ["当天新发起的匿名话题数量。", "Anonymous topics started that day."],
  anonymousMessages: ["当天在匿名话题中发送的点评数量。", "Messages posted in anonymous topics that day."],
  anonymousLikes: ["当天新增且当前仍有效的匿名点评点赞记录数量。", "Anonymous message likes added that day and still active."],
  anonymousFavorites: ["当天新增且当前仍有效的话题喜欢记录数量。", "Topic favorites added that day and still active."],
  notifications: ["当天创建的站内通知数量。", "In-app notifications created that day."],
  notificationReads: ["当天被标记为已读的站内通知数量。", "In-app notifications marked read that day."],
  notificationOpens: ["当天打开并进入关联内容的站内通知数量。", "In-app notifications opened to their linked content that day."],
  onboardingCompleted: ["当天提交兴趣专题和作者选择的账号数量。", "Accounts that completed topic and author selection that day."],
  resourceExchanges: ["当天完成的文章资源区域兑换次数。", "Article resource sections unlocked that day."],
  resourcePointsSpent: ["当天用户兑换文章资源实际扣除的积分总数。", "Points deducted for article resource unlocks that day."],
  resourcePointsPending: ["当天新产生、将在 72 小时后向作者入账的资源收益积分。", "New resource income created that day and due to settle to authors after 72 hours."],
  resourcePointsSettled: ["当天完成 72 小时结算并入账给作者的资源收益积分。", "Resource income settled to authors after the 72-hour hold that day."],
};

const storageCategories: Record<string, LocalizedPair> = {
  backgrounds: ["背景图片", "Background images"],
  "site-assets": ["站点资源", "Site assets"],
  "android-releases": ["Android 安装包", "Android packages"],
  avatars: ["用户头像", "User avatars"],
  articles: ["文章媒体", "Article media"],
  chat: ["聊天附件", "Chat attachments"],
};

const growthLevels: Record<string, LocalizedPair> = {
  qi_refining: ["练气", "Qi Refining"],
  foundation_building: ["筑基", "Foundation Building"],
  golden_core: ["金丹", "Golden Core"],
  nascent_soul: ["元婴", "Nascent Soul"],
  spirit_transformation: ["化神", "Spirit Transformation"],
  void_refining: ["炼虚", "Void Refining"],
  body_integration: ["合体", "Body Integration"],
  mahayana: ["大乘", "Mahayana"],
};

const notificationTypes: Record<string, LocalizedPair> = {
  friend_request_received: ["新的好友申请", "New friend request"],
  friend_request_accepted: ["好友申请已通过", "Friend request approved"],
  friend_request_declined: ["好友申请未通过", "Friend request declined"],
  comment_report_resolved: ["评论举报处理结果", "Comment report resolved"],
  comment_report_rejected: ["评论举报处理结果", "Comment report rejected"],
  comment_author_moderated: ["评论处理通知", "Comment moderation notice"],
  article_report_received: ["文章待处理举报", "Article report pending"],
  article_report_resolved: ["文章举报处理结果", "Article report resolved"],
  article_report_rejected: ["文章举报处理结果", "Article report rejected"],
  article_author_moderated: ["文章处理通知", "Article moderation notice"],
  article_appeal_received: ["文章申诉待处理", "Article appeal pending"],
  article_appeal_resolved: ["文章申诉处理结果", "Article appeal resolved"],
  article_publish_restricted: ["文章发布受限", "Article publishing restricted"],
  feedback_updated: ["用户反馈已更新", "User feedback updated"],
  article_liked: ["文章收到点赞", "Article received a like"],
  article_favorited: ["文章被收藏", "Article favorited"],
  article_commented: ["文章有新评论", "New article comment"],
  comment_replied: ["评论有新回复", "New comment reply"],
  author_subscribed: ["新的订阅者", "New subscriber"],
  subscription_published: ["订阅作者发布新文章", "Subscribed author published"],
  suggestion_updated: ["建议进度已更新", "Suggestion progress updated"],
  article_scheduled_publish: ["文章已按计划发布", "Article published on schedule"],
  article_scheduled_publish_failed: ["文章定时发布失败", "Scheduled publication failed"],
  article_scheduled_unpublish: ["文章已按计划下线", "Article taken offline on schedule"],
};

const notificationKinds: Record<string, LocalizedPair> = {
  stranger_message_request: ["新的陌生消息请求", "New message request"],
  group_invitation: ["新的群聊邀请", "New group invitation"],
  group_join_request: ["新的入群申请", "New group join request"],
  group_report: ["群消息待处理举报", "Group message report pending"],
  group_ban: ["群聊状态通知", "Group status notice"],
};

export function reputationReasonLabel(reason: ReputationReason, locale: Locale, fallback: string): string {
  return reputationReasons[reason] ? pick(locale, reputationReasons[reason]) : fallback;
}

export function auditActionLabel(action: string, locale: Locale, fallback: string): string {
  const [targetCode, operationCode] = action.split(".");
  const target = targetCode ? auditTargets[targetCode] : undefined;
  const operation = operationCode ? auditOperations[operationCode] : undefined;
  return target && operation ? `${pick(locale, target)} · ${pick(locale, operation)}` : fallback;
}

export function analyticsDefinitionLabel(key: string, locale: Locale, fallback: string): string {
  return analyticsDefinitions[key] ? pick(locale, analyticsDefinitions[key]) : fallback;
}

export function analyticsDefinitionDescription(key: string, locale: Locale, fallback: string): string {
  return analyticsDefinitionDetails[key] ? pick(locale, analyticsDefinitionDetails[key]) : fallback;
}

export function analyticsRankingSecondary(category: string, secondary: string, locale: Locale): string {
  if (locale !== "en-US") return secondary;
  if (category === "search" && secondary === "累计搜索") return "Cumulative searches";
  if (category === "anonymous_topic") {
    const matched = secondary.match(/^(\d+) 条讨论 · (\d+) 次喜欢$/);
    if (matched) return `${matched[1]} discussions · ${matched[2]} favorites`;
  }
  return secondary;
}

export function storageCategoryLabel(key: string, locale: Locale, fallback: string): string {
  return storageCategories[key] ? pick(locale, storageCategories[key]) : fallback;
}

export function growthLevelLabel(code: string, locale: Locale, fallback: string): string {
  return growthLevels[code] ? pick(locale, growthLevels[code]) : fallback;
}

export function notificationTitle(
  type: string,
  kind: string | undefined,
  locale: Locale,
  fallback: string,
): string {
  const value = notificationTypes[type] ?? (kind ? notificationKinds[kind] : undefined);
  return value ? pick(locale, value) : fallback;
}

export function notificationBody(body: string, bodyEn: string | null, locale: Locale): string {
  return locale === "en-US" && bodyEn ? bodyEn : body;
}

export function containerRuntimeMessage(locale: Locale, fallback: string): string {
  return fallback === "为避免授予 Web API 宿主机控制权限，容器状态请在 1Panel 或 SSH 中查看。"
    ? pick(locale, ["为避免授予 Web API 宿主机控制权限，容器状态请在 1Panel 或 SSH 中查看。", "Container status is available through 1Panel or SSH so the Web API does not receive host-control access."])
    : fallback;
}

interface MediaBackupLog {
  event: string;
  message: string;
  fileId: number | null;
  provider: "oss" | "r2" | null;
  attempt: number | null;
}

interface MediaBackupJobContext {
  totalFiles: number;
  uploadedFiles: number;
  reusedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  manifests: Array<{ fileId: number; storedName: string }>;
}

export function mediaBackupLogMessage(log: MediaBackupLog, job: MediaBackupJobContext, locale: Locale): string {
  if (locale !== "en-US") return log.message;
  const filename = log.fileId === null ? "" : job.manifests.find((item) => item.fileId === log.fileId)?.storedName ?? "media file";
  const provider = log.provider?.toUpperCase() ?? "remote storage";
  if (log.event === "job.interrupted") return "Service restarted and stopped the incomplete media backup job.";
  if (log.event === "job.started") return `Started sequential processing for ${job.totalFiles} media files.`;
  if (log.event === "job.completed") return `Media backup completed: uploaded ${job.uploadedFiles}, reused ${job.reusedFiles}, skipped ${job.skippedFiles}, failed ${job.failedFiles}.`;
  if (log.event === "file.skipped") return `Skipped ${filename} because it is temporary, trashed, or still uploading.`;
  if (log.event === "file.reused") return `Reused the existing ${provider} object for ${filename}.`;
  if (log.event === "file.uploaded") return `Uploaded ${filename} to ${provider}.`;
  if (log.event === "hash.reused") return `Reused the existing hash for ${filename}; size and modified time are unchanged.`;
  if (log.event === "hash.computed") return `Computed the SHA-256 hash for ${filename}.`;
  if (log.event === "upload.retry") return `Upload to ${provider} failed for ${filename}; retrying (attempt ${log.attempt ?? 0}).`;
  if (log.event === "upload.failed") return `Upload to ${provider} failed for ${filename} after ${log.attempt ?? 0} attempts.`;
  if (log.event === "retention.completed") {
    const count = log.message.match(/\d+/)?.[0] ?? "0";
    return `Removed ${count} expired media backup jobs.`;
  }
  if (log.event === "retention.deferred") return "Remote retention cleanup was deferred. See the original log for the provider error.";
  return log.message;
}
