import { Injectable } from "@nestjs/common";
import {
  AnnouncementAudience,
  AnnouncementStatus,
  ArticleStatus,
  ArticleTaxonomyKind,
  ArticleTopicStatus,
  ArticleVisibility,
  ChatGroupJoinMode,
  ChatGroupMemberStatus,
  ChatGroupStatus,
  FriendshipStatus,
  PortalCategoryKind,
  PortalRecordStatus,
  PortalVisibility,
  Prisma,
  ProfileAccessLevel,
  UserStatus,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { SearchQueryDto } from "./dto/search.dto";
import { normalizeSearchKeyword, searchNeedles } from "./search-normalization";
import {
  GlobalSearchResponse,
  HotSearchResponse,
  SearchArticleResult,
  SearchAnnouncementResult,
  SearchChatGroupResult,
  SearchCategoryFilter,
  SearchCollectionResult,
  SearchEntryResult,
  SearchGroup,
  SearchHistoryResponse,
  SearchTopicResult,
  SearchUserResult,
} from "./search.types";

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchQueryDto, user: AuthenticatedUser | null): Promise<GlobalSearchResponse> {
    query.sort ??= "relevance";
    const keyword = query.q.trim();
    const activeScope = query.scope ?? "all";
    const wants = (scope: Exclude<SearchQueryDto["scope"], undefined>) => activeScope === "all" || activeScope === scope;
    const [articles, users, navigation, tools, topics, collections, groups, announcements, filters] = await Promise.all([
      wants("articles") ? this.searchArticles(keyword, query, user) : Promise.resolve(this.emptyGroup<SearchArticleResult>(query)),
      wants("users") ? this.searchUsers(keyword, query, user) : Promise.resolve(this.emptyGroup<SearchUserResult>(query)),
      wants("navigation") ? this.searchEntries(keyword, query, user, "navigation") : Promise.resolve(this.emptyGroup<SearchEntryResult>(query)),
      wants("tools") ? this.searchEntries(keyword, query, user, "tools") : Promise.resolve(this.emptyGroup<SearchEntryResult>(query)),
      wants("topics") ? this.searchTopics(keyword, query, user) : Promise.resolve(this.emptyGroup<SearchTopicResult>(query)),
      wants("collections") ? this.searchCollections(keyword, query, user) : Promise.resolve(this.emptyGroup<SearchCollectionResult>(query)),
      wants("groups") ? this.searchGroups(keyword, query, user) : Promise.resolve(this.emptyGroup<SearchChatGroupResult>(query)),
      wants("announcements") ? this.searchAnnouncements(keyword, query, user) : Promise.resolve(this.emptyGroup<SearchAnnouncementResult>(query)),
      this.listFilters(user),
    ]);
    return { query: keyword, sort: query.sort, articles, users, navigation, tools, topics, collections, groups, announcements, filters };
  }

  async listHistory(userId: number): Promise<{ items: SearchHistoryResponse[] }> {
    const records = await this.prisma.searchHistory.findMany({
      where: { userId },
      orderBy: [{ lastSearchedAt: "desc" }, { id: "desc" }],
      take: 20,
      select: { id: true, keyword: true, searchCount: true, lastSearchedAt: true },
    });
    return { items: records.map((record) => ({
      ...record,
      lastSearchedAt: record.lastSearchedAt.toISOString(),
    })) };
  }

  async listHot(limit: number): Promise<{ items: HotSearchResponse[] }> {
    const records = await this.prisma.searchKeywordStat.findMany({
      orderBy: [{ searchCount: "desc" }, { lastSearchedAt: "desc" }],
      take: limit,
      select: { keyword: true, searchCount: true },
    });
    return { items: records };
  }

  async recordSearch(keywordInput: string, userId: number): Promise<{ success: true }> {
    const keyword = keywordInput.trim();
    const normalizedKey = normalizeSearchKeyword(keyword);
    if (!normalizedKey) return { success: true };
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.searchHistory.upsert({
        where: { userId_normalizedKey: { userId, normalizedKey } },
        create: { userId, keyword, normalizedKey, lastSearchedAt: now },
        update: { keyword, searchCount: { increment: 1 }, lastSearchedAt: now },
      }),
      this.prisma.searchKeywordStat.upsert({
        where: { normalizedKey },
        create: { keyword, normalizedKey, lastSearchedAt: now },
        update: { keyword, searchCount: { increment: 1 }, lastSearchedAt: now },
      }),
    ]);
    return { success: true };
  }

  async deleteHistory(id: number, userId: number): Promise<{ success: true }> {
    await this.prisma.searchHistory.deleteMany({ where: { id, userId } });
    return { success: true };
  }

  async clearHistory(userId: number): Promise<{ count: number }> {
    return this.prisma.searchHistory.deleteMany({ where: { userId } });
  }

  private async searchArticles(
    keyword: string,
    query: SearchQueryDto,
    user: AuthenticatedUser | null,
  ): Promise<SearchGroup<SearchArticleResult>> {
    const visibility = this.articleVisibility(user);
    const normalizedKeyword = normalizeSearchKeyword(keyword);
    const needles = searchNeedles(keyword);
    const where: Prisma.ArticleWhereInput = {
      status: ArticleStatus.published,
      category: query.category?.trim() || undefined,
      AND: [
        visibility,
        {
          OR: [
            ...this.indexConditions<Prisma.ArticleWhereInput>(needles),
            { content: { contains: normalizedKeyword } },
            { author: { is: { searchText: { contains: normalizedKeyword } } } },
            ...needles.map((needle) => ({ author: { is: { searchPinyin: { contains: needle } } } })),
          ],
        },
      ],
    };
    const [total, records] = await Promise.all([
      this.prisma.article.count({ where }),
      this.prisma.article.findMany({
        where,
        orderBy: this.articleOrderBy(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          title: true,
          slug: true,
          category: true,
          tags: true,
          publishedAt: true,
          viewCount: true,
          likeCount: true,
          favoriteCount: true,
          commentCount: true,
          author: {
            select: {
              id: true,
              username: true,
              nickname: true,
              avatarStoredName: true,
              isSuperAdmin: true,
              isAdministrator: true,
              role: { select: { code: true, name: true, level: true } },
            },
          },
        },
      }),
    ]);
    return this.group(records.map((article) => ({
      ...article,
      tags: article.tags ? article.tags.split(",").filter(Boolean) : [],
      publishedAt: article.publishedAt?.toISOString() ?? null,
      author: {
        id: article.author.id,
        username: article.author.username.startsWith("deleted-") ? "deleted-user" : article.author.username,
        nickname: article.author.username.startsWith("deleted-") ? "已注销用户" : (article.author.nickname || article.author.username),
        avatarUrl: article.author.username.startsWith("deleted-") ? null : (article.author.avatarStoredName ? `/auth/avatars/${article.author.avatarStoredName}` : null),
        isSuperAdmin: article.author.username.startsWith("deleted-") ? false : article.author.isSuperAdmin,
        isAdministrator: article.author.username.startsWith("deleted-") ? false : article.author.isAdministrator,
        role: {
          ...article.author.role,
          name: article.author.role.name,
        },
      },
    })), total, query);
  }

  private async searchUsers(keyword: string, query: SearchQueryDto, user: AuthenticatedUser | null): Promise<SearchGroup<SearchUserResult>> {
    const needles = searchNeedles(keyword);
    const where: Prisma.UserWhereInput = {
      status: UserStatus.active,
      AND: [
        { OR: this.indexConditions<Prisma.UserWhereInput>(needles) },
        this.searchableUserVisibility(user),
      ],
    };
    const [total, records] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          username: true,
          nickname: true,
          avatarStoredName: true,
          profileBio: true,
          isSuperAdmin: true,
          isAdministrator: true,
          role: { select: { code: true, name: true, level: true } },
          createdAt: true,
        },
      }),
    ]);
    return this.group(records.map((record) => ({
      id: record.id,
      username: record.username,
      nickname: record.nickname || record.username,
      avatarUrl: record.avatarStoredName ? `/auth/avatars/${record.avatarStoredName}` : null,
      profileBio: record.profileBio,
      isSuperAdmin: record.isSuperAdmin,
      isAdministrator: record.isAdministrator,
      role: record.role,
      createdAt: record.createdAt.toISOString(),
    })), total, query);
  }

  private async searchTopics(keyword: string, query: SearchQueryDto, user: AuthenticatedUser | null): Promise<SearchGroup<SearchTopicResult>> {
    const needles = searchNeedles(keyword);
    const where: Prisma.ArticleTopicWhereInput = {
      AND: [
        this.topicVisibility(user),
        {
          OR: needles.flatMap((needle) => [
            { title: { contains: needle } },
            { slug: { contains: needle } },
            { description: { contains: needle } },
          ]),
        },
      ],
    };
    const [total, records] = await Promise.all([
      this.prisma.articleTopic.count({ where }),
      this.prisma.articleTopic.findMany({
        where,
        orderBy: query.sort === "latest" ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ sortOrder: "asc" }, { updatedAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, title: true, slug: true, description: true, coverPath: true, updatedAt: true, _count: { select: { items: true, subscribers: true } } },
      }),
    ]);
    return this.group(records.map((record) => ({
      id: record.id,
      title: record.title,
      slug: record.slug,
      description: record.description,
      coverPath: record.coverPath,
      articleCount: record._count.items,
      subscriberCount: record._count.subscribers,
      updatedAt: record.updatedAt.toISOString(),
    })), total, query);
  }

  private async searchCollections(keyword: string, query: SearchQueryDto, user: AuthenticatedUser | null): Promise<SearchGroup<SearchCollectionResult>> {
    const needles = searchNeedles(keyword);
    const where: Prisma.ArticleCollectionWhereInput = {
      AND: [
        this.collectionVisibility(user),
        { OR: needles.flatMap((needle) => [
          { name: { contains: needle } },
          { description: { contains: needle } },
          { owner: { is: { nickname: { contains: needle } } } },
          { owner: { is: { username: { contains: needle } } } },
        ]) },
      ],
    };
    const [total, records] = await Promise.all([
      this.prisma.articleCollection.count({ where }),
      this.prisma.articleCollection.findMany({
        where,
        orderBy: query.sort === "latest" ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ sortOrder: "asc" }, { updatedAt: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true, name: true, description: true, updatedAt: true,
          _count: { select: { items: true, subscribers: true } },
          owner: { select: { id: true, username: true, nickname: true, avatarStoredName: true } },
        },
      }),
    ]);
    return this.group(records.map((record) => ({
      id: record.id,
      name: record.name,
      description: record.description,
      articleCount: record._count.items,
      subscriberCount: record._count.subscribers,
      owner: {
        id: record.owner.id,
        username: record.owner.username,
        nickname: record.owner.nickname || record.owner.username,
        avatarUrl: record.owner.avatarStoredName ? `/auth/avatars/${record.owner.avatarStoredName}` : null,
      },
      updatedAt: record.updatedAt.toISOString(),
    })), total, query);
  }

  private async searchGroups(keyword: string, query: SearchQueryDto, user: AuthenticatedUser | null): Promise<SearchGroup<SearchChatGroupResult>> {
    if (!user) return this.emptyGroup<SearchChatGroupResult>(query);
    const needles = searchNeedles(keyword);
    const activeMember = { some: { userId: user.id, status: ChatGroupMemberStatus.active } };
    const where: Prisma.ChatGroupWhereInput = {
      status: ChatGroupStatus.active,
      AND: [
        { isBanned: false },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
        { members: { none: { userId: user.id, status: ChatGroupMemberStatus.blocked } } },
        { OR: [{ joinMode: ChatGroupJoinMode.approval, temporary: false }, { members: activeMember }] },
        { OR: needles.flatMap((needle) => [{ name: { contains: needle } }, { announcement: { contains: needle } }]) },
      ],
    };
    const [total, records] = await Promise.all([
      this.prisma.chatGroup.count({ where }),
      this.prisma.chatGroup.findMany({
        where,
        orderBy: query.sort === "latest" ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true, conversationId: true, name: true, avatarUrl: true, avatarStoredName: true,
          announcement: true, joinMode: true, updatedAt: true,
          members: { where: { userId: user.id, status: ChatGroupMemberStatus.active }, select: { userId: true }, take: 1 },
          _count: { select: { members: { where: { status: ChatGroupMemberStatus.active } } } },
        },
      }),
    ]);
    return this.group(records.map((record) => ({
      id: record.id,
      conversationId: record.conversationId,
      name: record.name,
      avatarUrl: record.avatarStoredName ? `/social/groups/${record.id}/avatar` : record.avatarUrl,
      announcement: record.announcement,
      memberCount: record._count.members,
      joinMode: record.joinMode,
      isMember: Boolean(record.members.length),
      updatedAt: record.updatedAt.toISOString(),
    })), total, query);
  }

  private async searchAnnouncements(keyword: string, query: SearchQueryDto, user: AuthenticatedUser | null): Promise<SearchGroup<SearchAnnouncementResult>> {
    const needles = searchNeedles(keyword);
    const where: Prisma.AnnouncementWhereInput = {
      AND: [
        this.announcementVisibility(user),
        { OR: needles.flatMap((needle) => [{ title: { contains: needle } }, { summary: { contains: needle } }, { content: { contains: needle } }]) },
      ],
    };
    const [total, records] = await Promise.all([
      this.prisma.announcement.count({ where }),
      this.prisma.announcement.findMany({
        where,
        orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: { id: true, title: true, summary: true, isPinned: true, publishedAt: true, expiresAt: true },
      }),
    ]);
    return this.group(records.map((record) => ({ ...record, publishedAt: record.publishedAt?.toISOString() ?? null, expiresAt: record.expiresAt?.toISOString() ?? null })), total, query);
  }

  private async searchEntries(
    keyword: string,
    query: SearchQueryDto,
    user: AuthenticatedUser | null,
    scope: "navigation" | "tools",
  ): Promise<SearchGroup<SearchEntryResult>> {
    const kinds = scope === "navigation"
      ? [PortalCategoryKind.navigation, PortalCategoryKind.custom_page]
      : [PortalCategoryKind.tool];
    const needles = searchNeedles(keyword);
    const where: Prisma.PortalEntryWhereInput = {
      status: PortalRecordStatus.active,
      category: {
        status: PortalRecordStatus.active,
        kind: { in: kinds },
        slug: query.category?.trim() || undefined,
      },
      AND: [
        this.portalVisibility(user),
        { OR: [
          ...this.indexConditions<Prisma.PortalEntryWhereInput>(needles),
          ...needles.map((needle) => ({ category: { name: { contains: needle } } })),
        ] },
      ],
    };
    const [total, records] = await Promise.all([
      this.prisma.portalEntry.count({ where }),
      this.prisma.portalEntry.findMany({
        where,
        orderBy: query.sort === "latest"
          ? [{ updatedAt: "desc" }, { id: "desc" }]
          : [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          title: true,
          description: true,
          url: true,
          iconPath: true,
          openInNewTab: true,
          category: { select: { id: true, name: true, slug: true, kind: true } },
        },
      }),
    ]);
    return this.group(records.map((record) => ({
      ...record,
      category: record.category as SearchEntryResult["category"],
    })), total, query);
  }

  private async listFilters(user: AuthenticatedUser | null): Promise<GlobalSearchResponse["filters"]> {
    const visibleEntryWhere = this.portalVisibility(user);
    const [articleCategories, portalCategories] = await Promise.all([
      this.prisma.articleTaxonomy.findMany({
        where: { kind: ArticleTaxonomyKind.category, enabled: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { name: true },
      }),
      this.prisma.portalCategory.findMany({
        where: {
          status: PortalRecordStatus.active,
          kind: { in: [PortalCategoryKind.navigation, PortalCategoryKind.custom_page, PortalCategoryKind.tool] },
          entries: {
            some: {
              status: PortalRecordStatus.active,
              ...visibleEntryWhere,
            },
          },
        },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: { name: true, slug: true, kind: true },
      }),
    ]);
    const mapCategory = (name: string, value: string): SearchCategoryFilter => ({ name, value });
    return {
      articleCategories: articleCategories.map(({ name }) => mapCategory(name, name)),
      navigationCategories: portalCategories
        .filter(({ kind }) => kind === PortalCategoryKind.navigation || kind === PortalCategoryKind.custom_page)
        .map(({ name, slug }) => mapCategory(name, slug)),
      toolCategories: portalCategories
        .filter(({ kind }) => kind === PortalCategoryKind.tool)
        .map(({ name, slug }) => mapCategory(name, slug)),
    };
  }

  private articleVisibility(user: AuthenticatedUser | null): Prisma.ArticleWhereInput {
    if (!user) return { visibility: ArticleVisibility.public };
    if (user.isSuperAdmin) return {};
    return { OR: [
      { visibility: ArticleVisibility.public },
      { visibility: ArticleVisibility.authenticated },
      { visibility: ArticleVisibility.private, authorId: user.id },
      { visibility: ArticleVisibility.role_restricted, allowedRoles: { some: { role: { code: user.role.code } } } },
    ] };
  }

  private searchableUserVisibility(user: AuthenticatedUser | null): Prisma.UserWhereInput {
    const searchable: Prisma.UserWhereInput = {
      OR: [
        { profileSettings: null },
        { profileSettings: { is: { searchable: true } } },
      ],
    };
    if (!user) {
      return {
        AND: [
          searchable,
          { OR: [
            { profileSettings: null },
            { profileSettings: { is: { profileAccess: ProfileAccessLevel.public } } },
          ] },
        ],
      };
    }
    return {
      AND: [
        searchable,
        {
          friendshipsAsOne: { none: { userTwoId: user.id, status: FriendshipStatus.blocked } },
          friendshipsAsTwo: { none: { userOneId: user.id, status: FriendshipStatus.blocked } },
        },
        { OR: [
          { id: user.id },
          { profileSettings: null },
          { profileSettings: { is: { profileAccess: { in: [ProfileAccessLevel.public, ProfileAccessLevel.authenticated] } } } },
          {
            AND: [
              { profileSettings: { is: { profileAccess: ProfileAccessLevel.friends } } },
              { OR: [
                { friendshipsAsOne: { some: { userTwoId: user.id, status: FriendshipStatus.accepted } } },
                { friendshipsAsTwo: { some: { userOneId: user.id, status: FriendshipStatus.accepted } } },
              ] },
            ],
          },
        ] },
      ],
    };
  }

  private collectionVisibility(user: AuthenticatedUser | null): Prisma.ArticleCollectionWhereInput {
    if (!user) return { visibility: ArticleVisibility.public };
    if (user.isSuperAdmin) return {};
    return { OR: [
      { visibility: ArticleVisibility.public },
      { visibility: ArticleVisibility.authenticated },
      { visibility: ArticleVisibility.private, ownerId: user.id },
    ] };
  }

  private topicVisibility(user: AuthenticatedUser | null): Prisma.ArticleTopicWhereInput {
    const base: Prisma.ArticleTopicWhereInput = { status: ArticleTopicStatus.active };
    if (!user) return { ...base, visibility: PortalVisibility.public };
    if (user.isSuperAdmin) return base;
    return {
      ...base,
      OR: [
        { visibility: PortalVisibility.public },
        { visibility: PortalVisibility.authenticated },
        { visibility: PortalVisibility.role_restricted, allowedRoles: { some: { role: { code: user.role.code } } } },
      ],
    };
  }

  private announcementVisibility(user: AuthenticatedUser | null): Prisma.AnnouncementWhereInput {
    const now = new Date();
    const audience: Prisma.AnnouncementWhereInput[] = [{ audience: AnnouncementAudience.public }];
    if (user) {
      audience.push(
        { audience: AnnouncementAudience.authenticated },
        { audience: AnnouncementAudience.role_restricted, allowedRoles: { some: { role: { code: user.role.code } } } },
      );
    }
    return {
      status: AnnouncementStatus.published,
      publishedAt: { lte: now },
      OR: audience,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    };
  }

  private portalVisibility(user: AuthenticatedUser | null): Prisma.PortalEntryWhereInput {
    if (!user) return { visibility: PortalVisibility.public };
    if (user.isSuperAdmin) return {};
    return { OR: [
      { visibility: PortalVisibility.public },
      { visibility: PortalVisibility.authenticated },
      { visibility: PortalVisibility.role_restricted, allowedRoles: { some: { role: { code: user.role.code } } } },
    ] };
  }

  private indexConditions<T>(needles: string[]): T[] {
    return needles.flatMap((needle) => [
      { searchText: { contains: needle } } as T,
      { searchPinyin: { contains: needle } } as T,
    ]);
  }

  private articleOrderBy(sort: SearchQueryDto["sort"]): Prisma.ArticleOrderByWithRelationInput[] {
    if (sort === "latest") return [{ publishedAt: "desc" }, { id: "desc" }];
    if (sort === "popular") {
      return [
        { isPinned: "desc" },
        { viewCount: "desc" },
        { likeCount: "desc" },
        { favoriteCount: "desc" },
        { commentCount: "desc" },
        { publishedAt: "desc" },
      ];
    }
    return [{ isPinned: "desc" }, { publishedAt: "desc" }, { id: "desc" }];
  }

  private emptyGroup<T>(query: SearchQueryDto): SearchGroup<T> {
    return { items: [], total: 0, page: query.page, pageSize: query.pageSize, totalPages: 1 };
  }

  private group<T>(items: T[], total: number, query: SearchQueryDto): SearchGroup<T> {
    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }
}
