import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ArticleTaxonomyKind,
  ArticleVisibility,
  Prisma,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  UpsertArticleTaxonomyDto,
  UpdateSiteSettingsDto,
} from "./dto/site-settings.dto";
import {
  AndroidReleasePolicy,
  ArticlePublishPolicy,
  ArticleTaxonomyResponse,
  NotificationSettingsResponse,
  NotificationTemplateName,
  RegistrationPolicy,
  SiteSettingsResponse,
} from "./site-settings.types";

interface SiteSettingRecord {
  siteName: string;
  browserTitle: string;
  logoPath: string;
  pwaIconPath: string;
  defaultBackgroundUrl: string;
  defaultThemeId: string;
  defaultAccent: string;
  defaultSurface: string;
  defaultForeground: string;
  defaultMuted: string;
  defaultCardAlpha: number;
  defaultGlassBlur: number;
  defaultGlassTint: string;
  defaultGlassTintAlpha: number;
  registrationOpen: boolean;
  defaultRoleCode: string;
  installPageEnabled: boolean;
  apkHistoryEnabled: boolean;
  apkAutoCleanupEnabled: boolean;
  apkRetentionCount: number;
  defaultArticleVisibility: ArticleVisibility;
  articleImageMaxSizeMb: number;
  commentsEnabled: boolean;
  reportsEnabled: boolean;
  notifyArticleLiked: boolean;
  notifyArticleFavorited: boolean;
  notifyArticleCommented: boolean;
  notifyCommentReplied: boolean;
  notifyAuthorSubscribed: boolean;
  notifySubscriptionPublished: boolean;
  notifyFriendRequest: boolean;
  notifyCommentReport: boolean;
  notifySystem: boolean;
  templateArticleLiked: string;
  templateArticleFavorited: string;
  templateArticleCommented: string;
  templateCommentReplied: string;
  templateAuthorSubscribed: string;
  templateSubscriptionPublished: string;
  templateFriendRequest: string;
  templateCommentReportHandled: string;
  templateCommentAuthorModerated: string;
  updatedAt: Date;
}

interface ArticleTaxonomyRecord {
  id: number;
  kind: ArticleTaxonomyKind;
  name: string;
  color: string;
  sortOrder: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const SETTINGS_ID = 1;
const DEFAULT_TAXONOMY_COLOR = "#7c8faa";
const DEFAULT_SITE_SETTINGS: Prisma.SiteSettingUpdateInput = {
  siteName: "HLOVET",
  browserTitle: "HLOVET",
  logoPath: "/favicon.svg",
  pwaIconPath: "/icon-192.png",
  defaultBackgroundUrl: "/images/hlovet-city-lights.jpg",
  defaultThemeId: "cloud-blue",
  defaultAccent: "#1814f0",
  defaultSurface: "#dfc8c8",
  defaultForeground: "#2b2530",
  defaultMuted: "#665867",
  defaultCardAlpha: 50,
  defaultGlassBlur: 18,
  defaultGlassTint: "#fff3f6",
  defaultGlassTintAlpha: 0,
  registrationOpen: true,
  defaultRoleCode: "qi_refining",
  installPageEnabled: true,
  apkHistoryEnabled: true,
  apkAutoCleanupEnabled: false,
  apkRetentionCount: 3,
  defaultArticleVisibility: ArticleVisibility.public,
  articleImageMaxSizeMb: 10,
  commentsEnabled: true,
  reportsEnabled: true,
  notifyArticleLiked: true,
  notifyArticleFavorited: true,
  notifyArticleCommented: true,
  notifyCommentReplied: true,
  notifyAuthorSubscribed: true,
  notifySubscriptionPublished: true,
  notifyFriendRequest: true,
  notifyCommentReport: true,
  notifySystem: true,
  templateArticleLiked: "{actor} 点赞了《{article}》。",
  templateArticleFavorited: "{actor} 收藏了《{article}》。",
  templateArticleCommented: "{actor} 评论了《{article}》。",
  templateCommentReplied: "{actor} 回复了你在《{article}》中的评论。",
  templateAuthorSubscribed: "{actor} 订阅了你。",
  templateSubscriptionPublished: "{author} 发布了《{article}》。",
  templateFriendRequest: "{actor} 向你发送了好友申请。",
  templateCommentReportHandled: "你对《{article}》中评论的举报已{result}。",
  templateCommentAuthorModerated: "你在《{article}》中的评论已被{result}。",
};

@Injectable()
export class SiteSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getPublicSettings(): Promise<SiteSettingsResponse> {
    const [settings, taxonomies] = await Promise.all([
      this.getSettingsRecord(),
      this.listTaxonomyRecords({ enabledOnly: true }),
    ]);
    return this.toResponse(settings, taxonomies);
  }

  async getAdminSettings(): Promise<SiteSettingsResponse> {
    const [settings, taxonomies] = await Promise.all([
      this.getSettingsRecord(),
      this.listTaxonomyRecords({ enabledOnly: false }),
    ]);
    return this.toResponse(settings, taxonomies);
  }

  async updateSettings(dto: UpdateSiteSettingsDto): Promise<SiteSettingsResponse> {
    const data = await this.toSettingsUpdateData(dto);
    await this.getSettingsRecord();
    const settings = await this.prisma.siteSetting.update({
      where: { id: SETTINGS_ID },
      data,
      select: this.settingSelect(),
    });
    const taxonomies = await this.listTaxonomyRecords({ enabledOnly: false });
    return this.toResponse(settings, taxonomies);
  }

  async resetSettings(): Promise<SiteSettingsResponse> {
    await this.getSettingsRecord();
    const settings = await this.prisma.siteSetting.update({
      where: { id: SETTINGS_ID },
      data: DEFAULT_SITE_SETTINGS,
      select: this.settingSelect(),
    });
    const taxonomies = await this.listTaxonomyRecords({ enabledOnly: false });
    return this.toResponse(settings, taxonomies);
  }

  async createTaxonomy(dto: UpsertArticleTaxonomyDto): Promise<ArticleTaxonomyResponse> {
    const normalized = this.normalizeTaxonomyInput(dto);
    const existing = await this.prisma.articleTaxonomy.findUnique({
      where: {
        kind_name: {
          kind: normalized.kind,
          name: normalized.name,
        },
      },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException("分类或标签名称已经存在。");
    }

    const taxonomy = await this.prisma.articleTaxonomy.create({
      data: normalized,
      select: this.taxonomySelect(),
    });
    return this.toTaxonomyResponse(taxonomy);
  }

  async updateTaxonomy(id: number, dto: UpsertArticleTaxonomyDto): Promise<ArticleTaxonomyResponse> {
    const existing = await this.prisma.articleTaxonomy.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException("分类或标签不存在。");
    }

    const normalized = this.normalizeTaxonomyInput(dto);
    const taxonomy = await this.prisma.articleTaxonomy.update({
      where: { id },
      data: normalized,
      select: this.taxonomySelect(),
    });
    return this.toTaxonomyResponse(taxonomy);
  }

  async deleteTaxonomy(id: number): Promise<void> {
    const existing = await this.prisma.articleTaxonomy.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException("分类或标签不存在。");
    }
    await this.prisma.articleTaxonomy.delete({ where: { id } });
  }

  async getRegistrationPolicy(): Promise<RegistrationPolicy> {
    const settings = await this.getSettingsRecord();
    return {
      registrationOpen: settings.registrationOpen,
      defaultRoleCode: settings.defaultRoleCode,
    };
  }

  async getAndroidReleasePolicy(): Promise<AndroidReleasePolicy> {
    const settings = await this.getSettingsRecord();
    return {
      installPageEnabled: settings.installPageEnabled,
      apkHistoryEnabled: settings.apkHistoryEnabled,
      apkAutoCleanupEnabled: settings.apkAutoCleanupEnabled,
      apkRetentionCount: settings.apkRetentionCount,
    };
  }

  async getArticlePublishPolicy(): Promise<ArticlePublishPolicy> {
    const settings = await this.getSettingsRecord();
    return {
      defaultArticleVisibility: settings.defaultArticleVisibility,
      articleImageMaxSizeMb: settings.articleImageMaxSizeMb,
      commentsEnabled: settings.commentsEnabled,
      reportsEnabled: settings.reportsEnabled,
    };
  }

  async getNotificationSettings(): Promise<NotificationSettingsResponse> {
    const settings = await this.getSettingsRecord();
    return this.toNotificationSettings(settings);
  }

  renderTemplate(
    template: string,
    variables: Record<string, string | number | null | undefined>,
  ): string {
    const rendered = Object.entries(variables).reduce((current, [key, value]) => {
      return current.replaceAll(`{${key}}`, String(value ?? ""));
    }, template);
    return rendered.replace(/\{[a-zA-Z0-9_]+\}/g, "").replace(/\s+/g, " ").trim().slice(0, 500);
  }

  getTemplate(settings: NotificationSettingsResponse, name: NotificationTemplateName): string {
    return settings.templates[name];
  }

  private async getSettingsRecord(): Promise<SiteSettingRecord> {
    return this.prisma.siteSetting.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID },
      update: {},
      select: this.settingSelect(),
    });
  }

  private async toSettingsUpdateData(dto: UpdateSiteSettingsDto): Promise<Prisma.SiteSettingUpdateInput> {
    if (dto.defaultRoleCode !== undefined) {
      const role = await this.prisma.role.findUnique({
        where: { code: dto.defaultRoleCode.trim() },
        select: { code: true },
      });
      if (!role) {
        throw new BadRequestException("默认角色不存在。");
      }
    }

    return {
      siteName: dto.siteName === undefined ? undefined : this.trimOrFallback(dto.siteName, "HLOVET"),
      browserTitle: dto.browserTitle === undefined ? undefined : this.trimOrFallback(dto.browserTitle, "HLOVET"),
      logoPath: dto.logoPath === undefined ? undefined : this.normalizePath(dto.logoPath, "/favicon.svg"),
      pwaIconPath: dto.pwaIconPath === undefined ? undefined : this.normalizePath(dto.pwaIconPath, "/icon-192.png"),
      defaultBackgroundUrl: dto.defaultBackgroundUrl === undefined ? undefined : this.normalizePath(dto.defaultBackgroundUrl, "/images/hlovet-city-lights.jpg"),
      defaultThemeId: dto.defaultThemeId,
      defaultAccent: dto.defaultAccent,
      defaultSurface: dto.defaultSurface,
      defaultForeground: dto.defaultForeground,
      defaultMuted: dto.defaultMuted,
      defaultCardAlpha: dto.defaultCardAlpha,
      defaultGlassBlur: dto.defaultGlassBlur,
      defaultGlassTint: dto.defaultGlassTint,
      defaultGlassTintAlpha: dto.defaultGlassTintAlpha,
      registrationOpen: dto.registrationOpen,
      defaultRoleCode: dto.defaultRoleCode?.trim(),
      installPageEnabled: dto.installPageEnabled,
      apkHistoryEnabled: dto.apkHistoryEnabled,
      apkAutoCleanupEnabled: dto.apkAutoCleanupEnabled,
      apkRetentionCount: dto.apkRetentionCount,
      defaultArticleVisibility: dto.defaultArticleVisibility as ArticleVisibility | undefined,
      articleImageMaxSizeMb: dto.articleImageMaxSizeMb,
      commentsEnabled: dto.commentsEnabled,
      reportsEnabled: dto.reportsEnabled,
      notifyArticleLiked: dto.notifyArticleLiked,
      notifyArticleFavorited: dto.notifyArticleFavorited,
      notifyArticleCommented: dto.notifyArticleCommented,
      notifyCommentReplied: dto.notifyCommentReplied,
      notifyAuthorSubscribed: dto.notifyAuthorSubscribed,
      notifySubscriptionPublished: dto.notifySubscriptionPublished,
      notifyFriendRequest: dto.notifyFriendRequest,
      notifyCommentReport: dto.notifyCommentReport,
      notifySystem: dto.notifySystem,
      templateArticleLiked: dto.templateArticleLiked === undefined ? undefined : this.trimOrFallback(dto.templateArticleLiked, "{actor} 点赞了《{article}》。"),
      templateArticleFavorited: dto.templateArticleFavorited === undefined ? undefined : this.trimOrFallback(dto.templateArticleFavorited, "{actor} 收藏了《{article}》。"),
      templateArticleCommented: dto.templateArticleCommented === undefined ? undefined : this.trimOrFallback(dto.templateArticleCommented, "{actor} 评论了《{article}》。"),
      templateCommentReplied: dto.templateCommentReplied === undefined ? undefined : this.trimOrFallback(dto.templateCommentReplied, "{actor} 回复了你在《{article}》中的评论。"),
      templateAuthorSubscribed: dto.templateAuthorSubscribed === undefined ? undefined : this.trimOrFallback(dto.templateAuthorSubscribed, "{actor} 订阅了你。"),
      templateSubscriptionPublished: dto.templateSubscriptionPublished === undefined ? undefined : this.trimOrFallback(dto.templateSubscriptionPublished, "{author} 发布了《{article}》。"),
      templateFriendRequest: dto.templateFriendRequest === undefined ? undefined : this.trimOrFallback(dto.templateFriendRequest, "{actor} 向你发送了好友申请。"),
      templateCommentReportHandled: dto.templateCommentReportHandled === undefined ? undefined : this.trimOrFallback(dto.templateCommentReportHandled, "你对《{article}》中评论的举报已{result}。"),
      templateCommentAuthorModerated: dto.templateCommentAuthorModerated === undefined ? undefined : this.trimOrFallback(dto.templateCommentAuthorModerated, "你在《{article}》中的评论已被{result}。"),
    };
  }

  private normalizeTaxonomyInput(dto: UpsertArticleTaxonomyDto): Prisma.ArticleTaxonomyUncheckedCreateInput {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException("名称不能为空。");
    }
    return {
      kind: dto.kind as ArticleTaxonomyKind,
      name,
      color: dto.color ?? DEFAULT_TAXONOMY_COLOR,
      sortOrder: dto.sortOrder ?? 0,
      enabled: dto.enabled ?? true,
    };
  }

  private listTaxonomyRecords(options: { enabledOnly: boolean }): Promise<ArticleTaxonomyRecord[]> {
    return this.prisma.articleTaxonomy.findMany({
      where: options.enabledOnly ? { enabled: true } : undefined,
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      select: this.taxonomySelect(),
    });
  }

  private settingSelect() {
    return {
      siteName: true,
      browserTitle: true,
      logoPath: true,
      pwaIconPath: true,
      defaultBackgroundUrl: true,
      defaultThemeId: true,
      defaultAccent: true,
      defaultSurface: true,
      defaultForeground: true,
      defaultMuted: true,
      defaultCardAlpha: true,
      defaultGlassBlur: true,
      defaultGlassTint: true,
      defaultGlassTintAlpha: true,
      registrationOpen: true,
      defaultRoleCode: true,
      installPageEnabled: true,
      apkHistoryEnabled: true,
      apkAutoCleanupEnabled: true,
      apkRetentionCount: true,
      defaultArticleVisibility: true,
      articleImageMaxSizeMb: true,
      commentsEnabled: true,
      reportsEnabled: true,
      notifyArticleLiked: true,
      notifyArticleFavorited: true,
      notifyArticleCommented: true,
      notifyCommentReplied: true,
      notifyAuthorSubscribed: true,
      notifySubscriptionPublished: true,
      notifyFriendRequest: true,
      notifyCommentReport: true,
      notifySystem: true,
      templateArticleLiked: true,
      templateArticleFavorited: true,
      templateArticleCommented: true,
      templateCommentReplied: true,
      templateAuthorSubscribed: true,
      templateSubscriptionPublished: true,
      templateFriendRequest: true,
      templateCommentReportHandled: true,
      templateCommentAuthorModerated: true,
      updatedAt: true,
    } as const;
  }

  private taxonomySelect() {
    return {
      id: true,
      kind: true,
      name: true,
      color: true,
      sortOrder: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  private toResponse(
    settings: SiteSettingRecord,
    taxonomies: ArticleTaxonomyRecord[],
  ): SiteSettingsResponse {
    const categories = taxonomies
      .filter((taxonomy) => taxonomy.kind === ArticleTaxonomyKind.category)
      .map((taxonomy) => this.toTaxonomyResponse(taxonomy));
    const tags = taxonomies
      .filter((taxonomy) => taxonomy.kind === ArticleTaxonomyKind.tag)
      .map((taxonomy) => this.toTaxonomyResponse(taxonomy));

    return {
      siteName: settings.siteName,
      browserTitle: settings.browserTitle,
      logoPath: settings.logoPath,
      pwaIconPath: settings.pwaIconPath,
      defaultBackgroundUrl: settings.defaultBackgroundUrl,
      defaultTheme: {
        themeId: settings.defaultThemeId,
        customAccent: settings.defaultAccent,
        customSurface: settings.defaultSurface,
        customForeground: settings.defaultForeground,
        customMuted: settings.defaultMuted,
        cardAlpha: settings.defaultCardAlpha,
        glassBlur: settings.defaultGlassBlur,
        glassTint: settings.defaultGlassTint,
        glassTintAlpha: settings.defaultGlassTintAlpha,
      },
      registrationOpen: settings.registrationOpen,
      defaultRoleCode: settings.defaultRoleCode,
      installPageEnabled: settings.installPageEnabled,
      apkHistoryEnabled: settings.apkHistoryEnabled,
      apkAutoCleanupEnabled: settings.apkAutoCleanupEnabled,
      apkRetentionCount: settings.apkRetentionCount,
      defaultArticleVisibility: settings.defaultArticleVisibility,
      articleImageMaxSizeMb: settings.articleImageMaxSizeMb,
      commentsEnabled: settings.commentsEnabled,
      reportsEnabled: settings.reportsEnabled,
      notifications: this.toNotificationSettings(settings),
      taxonomies: { categories, tags },
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  private toNotificationSettings(settings: SiteSettingRecord): NotificationSettingsResponse {
    return {
      notifyArticleLiked: settings.notifyArticleLiked,
      notifyArticleFavorited: settings.notifyArticleFavorited,
      notifyArticleCommented: settings.notifyArticleCommented,
      notifyCommentReplied: settings.notifyCommentReplied,
      notifyAuthorSubscribed: settings.notifyAuthorSubscribed,
      notifySubscriptionPublished: settings.notifySubscriptionPublished,
      notifyFriendRequest: settings.notifyFriendRequest,
      notifyCommentReport: settings.notifyCommentReport,
      notifySystem: settings.notifySystem,
      templates: {
        articleLiked: settings.templateArticleLiked,
        articleFavorited: settings.templateArticleFavorited,
        articleCommented: settings.templateArticleCommented,
        commentReplied: settings.templateCommentReplied,
        authorSubscribed: settings.templateAuthorSubscribed,
        subscriptionPublished: settings.templateSubscriptionPublished,
        friendRequest: settings.templateFriendRequest,
        commentReportHandled: settings.templateCommentReportHandled,
        commentAuthorModerated: settings.templateCommentAuthorModerated,
      },
    };
  }

  private toTaxonomyResponse(taxonomy: ArticleTaxonomyRecord): ArticleTaxonomyResponse {
    return {
      id: taxonomy.id,
      kind: taxonomy.kind,
      name: taxonomy.name,
      color: taxonomy.color,
      sortOrder: taxonomy.sortOrder,
      enabled: taxonomy.enabled,
      createdAt: taxonomy.createdAt.toISOString(),
      updatedAt: taxonomy.updatedAt.toISOString(),
    };
  }

  private trimOrFallback(value: string, fallback: string): string {
    return value.trim() || fallback;
  }

  private normalizePath(value: string, fallback: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("/")) {
      return trimmed;
    }
    throw new BadRequestException("路径需要以 / 开头，或填写完整 http(s) 地址。");
  }
}
