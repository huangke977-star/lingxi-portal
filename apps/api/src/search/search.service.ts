import { Injectable } from "@nestjs/common";
import {
  ArticleStatus,
  ArticleTaxonomyKind,
  ArticleVisibility,
  PortalCategoryKind,
  PortalRecordStatus,
  PortalVisibility,
  Prisma,
  UserStatus,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { SearchQueryDto } from "./dto/search.dto";
import {
  GlobalSearchResponse,
  SearchArticleResult,
  SearchCategoryFilter,
  SearchEntryResult,
  SearchGroup,
  SearchUserResult,
} from "./search.types";

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: SearchQueryDto, user: AuthenticatedUser | null): Promise<GlobalSearchResponse> {
    const keyword = query.q.trim();
    const activeScope = query.scope ?? "all";
    const wants = (scope: Exclude<SearchQueryDto["scope"], undefined>) => activeScope === "all" || activeScope === scope;
    const [articles, users, navigation, tools, filters] = await Promise.all([
      wants("articles") ? this.searchArticles(keyword, query, user) : Promise.resolve(this.emptyGroup<SearchArticleResult>(query)),
      wants("users") ? this.searchUsers(keyword, query) : Promise.resolve(this.emptyGroup<SearchUserResult>(query)),
      wants("navigation") ? this.searchEntries(keyword, query, user, "navigation") : Promise.resolve(this.emptyGroup<SearchEntryResult>(query)),
      wants("tools") ? this.searchEntries(keyword, query, user, "tools") : Promise.resolve(this.emptyGroup<SearchEntryResult>(query)),
      this.listFilters(user),
    ]);
    return { query: keyword, articles, users, navigation, tools, filters };
  }

  private async searchArticles(
    keyword: string,
    query: SearchQueryDto,
    user: AuthenticatedUser | null,
  ): Promise<SearchGroup<SearchArticleResult>> {
    const visibility = this.articleVisibility(user);
    const where: Prisma.ArticleWhereInput = {
      status: ArticleStatus.published,
      category: query.category?.trim() || undefined,
      AND: [
        visibility,
        {
          OR: [
            { title: { contains: keyword } },
            { content: { contains: keyword } },
            { category: { contains: keyword } },
            { tags: { contains: keyword } },
            { author: { is: { nickname: { contains: keyword } } } },
            { author: { is: { username: { contains: keyword } } } },
          ],
        },
      ],
    };
    const [total, records] = await Promise.all([
      this.prisma.article.count({ where }),
      this.prisma.article.findMany({
        where,
        orderBy: [{ isPinned: "desc" }, { publishedAt: "desc" }, { id: "desc" }],
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
        username: article.author.username,
        nickname: article.author.nickname || article.author.username,
        avatarUrl: article.author.avatarStoredName ? `/auth/avatars/${article.author.avatarStoredName}` : null,
        isSuperAdmin: article.author.isSuperAdmin,
        role: {
          ...article.author.role,
          name: article.author.isSuperAdmin ? "超级管理员" : article.author.role.name,
        },
      },
    })), total, query);
  }

  private async searchUsers(keyword: string, query: SearchQueryDto): Promise<SearchGroup<SearchUserResult>> {
    const where: Prisma.UserWhereInput = {
      status: UserStatus.active,
      OR: [
        { username: { contains: keyword } },
        { nickname: { contains: keyword } },
        { profileBio: { contains: keyword } },
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
      role: { ...record.role, name: record.isSuperAdmin ? "超级管理员" : record.role.name },
      createdAt: record.createdAt.toISOString(),
    })), total, query);
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
    const where: Prisma.PortalEntryWhereInput = {
      status: PortalRecordStatus.active,
      category: {
        status: PortalRecordStatus.active,
        kind: { in: kinds },
        slug: query.category?.trim() || undefined,
      },
      AND: [
        this.portalVisibility(user),
        { OR: [{ title: { contains: keyword } }, { description: { contains: keyword } }] },
      ],
    };
    const [total, records] = await Promise.all([
      this.prisma.portalEntry.count({ where }),
      this.prisma.portalEntry.findMany({
        where,
        orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }, { id: "asc" }],
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

  private portalVisibility(user: AuthenticatedUser | null): Prisma.PortalEntryWhereInput {
    if (!user) return { visibility: PortalVisibility.public };
    if (user.isSuperAdmin) return {};
    return { OR: [
      { visibility: PortalVisibility.public },
      { visibility: PortalVisibility.authenticated },
      { visibility: PortalVisibility.role_restricted, allowedRoles: { some: { role: { code: user.role.code } } } },
    ] };
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
