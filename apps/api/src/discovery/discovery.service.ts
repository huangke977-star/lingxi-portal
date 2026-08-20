import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import {
  ArticleStatus,
  ArticleTopicStatus,
  ArticleVisibility,
  ChatGroupMemberStatus,
  ChatGroupStatus,
  DirectMessagePolicy,
  FriendRequestPolicy,
  FriendshipStatus,
  GroupInvitationPolicy,
  PortalVisibility,
  Prisma,
  ProfileAccessLevel,
  UserStatus,
} from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import {
  CreateArticleCollectionDto,
  CreateArticleTopicDto,
  ListCollectionsQueryDto,
  ListDiscoveryQueryDto,
  ListSubscriptionFeedQueryDto,
  ReorderContentItemsDto,
  UpdateArticleCollectionDto,
  UpdateArticleTopicDto,
  UpdateProfileSettingsDto,
} from "./dto/discovery.dto";
import {
  ArticleCollectionResponse,
  ArticleTopicResponse,
  DiscoveryArticleResponse,
  DiscoveryAuthorResponse,
  DiscoveryRecommendationsResponse,
  ProfileSettingsResponse,
  ProfileShowcaseResponse,
  SubscriptionFeedResponse,
  UploadedCollectionCover,
  UploadedTopicCover,
} from "./discovery.types";

export const TOPIC_COVER_MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const TOPIC_COVER_PUBLIC_PREFIX = "/discovery/topics/covers/";
const COLLECTION_COVER_PUBLIC_PREFIX = "/discovery/collections/covers/";

interface SupportedTopicCoverFormat {
  extension: string;
  extensions: string[];
  mimeType: string;
  matches: (buffer: Buffer) => boolean;
}

const TOPIC_COVER_FORMATS: SupportedTopicCoverFormat[] = [
  {
    extension: ".jpg",
    extensions: [".jpg", ".jpeg"],
    mimeType: "image/jpeg",
    matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    extension: ".png",
    extensions: [".png"],
    mimeType: "image/png",
    matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    extension: ".webp",
    extensions: [".webp"],
    mimeType: "image/webp",
    matches: (buffer) => buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP",
  },
  {
    extension: ".avif",
    extensions: [".avif"],
    mimeType: "image/avif",
    matches: (buffer) => buffer.length >= 12 && buffer.subarray(4, 12).toString("ascii").includes("ftypavif"),
  },
];

const discoveryArticleInclude = {
  author: {
    select: {
      id: true,
      nickname: true,
      username: true,
      avatarStoredName: true,
      isSuperAdmin: true,
      isAdministrator: true,
      role: { select: { code: true, name: true, level: true } },
    },
  },
  allowedRoles: { select: { role: { select: { code: true } } } },
  collectionItems: {
    select: {
      collection: {
        select: { id: true, ownerId: true, name: true, visibility: true },
      },
    },
  },
  topicItems: {
    select: {
      topic: {
        select: {
          id: true,
          title: true,
          slug: true,
          visibility: true,
          status: true,
          allowedRoles: { select: { role: { select: { code: true } } } },
        },
      },
    },
  },
} satisfies Prisma.ArticleInclude;

type DiscoveryArticleRecord = Prisma.ArticleGetPayload<{
  include: typeof discoveryArticleInclude;
}>;

const articleCollectionInclude = {
  owner: {
    select: {
      id: true,
      nickname: true,
      username: true,
      avatarStoredName: true,
      isSuperAdmin: true,
      isAdministrator: true,
      role: { select: { code: true, name: true, level: true } },
    },
  },
  items: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: { article: { include: discoveryArticleInclude } },
  },
  _count: { select: { subscribers: true } },
} satisfies Prisma.ArticleCollectionInclude;

type ArticleCollectionRecord = Prisma.ArticleCollectionGetPayload<{
  include: typeof articleCollectionInclude;
}>;

const articleTopicInclude = {
  allowedRoles: {
    orderBy: { role: { level: "asc" as const } },
    select: { role: { select: { code: true } } },
  },
  items: {
    orderBy: [{ sortOrder: "asc" as const }, { createdAt: "asc" as const }],
    include: { article: { include: discoveryArticleInclude } },
  },
  _count: { select: { subscribers: true } },
} satisfies Prisma.ArticleTopicInclude;

type ArticleTopicRecord = Prisma.ArticleTopicGetPayload<{
  include: typeof articleTopicInclude;
}>;

@Injectable()
export class DiscoveryService {
  private readonly topicCoverDirectory = resolve(
    process.env.ARTICLE_UPLOAD_DIR ?? join(process.cwd(), "uploads", "articles"),
    "topic-covers",
  );
  private readonly collectionCoverDirectory = resolve(
    process.env.ARTICLE_UPLOAD_DIR ?? join(process.cwd(), "uploads", "articles"),
    "collection-covers",
  );

  constructor(private readonly prisma: PrismaService) {}

  async listRecommendations(user: AuthenticatedUser): Promise<DiscoveryRecommendationsResponse> {
    const topicWhere: Prisma.ArticleTopicWhereInput = { ...this.topicVisibleWhere(user), subscribers: { none: { userId: user.id } } };
    const collectionWhere: Prisma.ArticleCollectionWhereInput = {
      AND: [this.collectionVisibleWhere(user), { ownerId: { not: user.id } }, { subscribers: { none: { userId: user.id } } }],
    };
    const now = new Date();
    const [topics, collections, groups] = await Promise.all([
      this.prisma.articleTopic.findMany({
        where: topicWhere, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8,
        select: { id: true, title: true, slug: true, description: true, coverPath: true, updatedAt: true, _count: { select: { items: true, subscribers: true } } },
      }),
      this.prisma.articleCollection.findMany({
        where: collectionWhere, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8,
        select: {
          id: true, name: true, description: true, updatedAt: true,
          _count: { select: { items: true, subscribers: true } },
          owner: { select: { id: true, nickname: true, username: true, avatarStoredName: true, isSuperAdmin: true, isAdministrator: true, role: { select: { code: true, name: true, level: true } } } },
        },
      }),
      this.prisma.chatGroup.findMany({
        where: {
          status: ChatGroupStatus.active,
          isBanned: false,
          temporary: false,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          members: { none: { userId: user.id, status: { in: [ChatGroupMemberStatus.active, ChatGroupMemberStatus.blocked] } } },
          joinMode: "approval",
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: 8,
        select: {
          id: true, conversationId: true, name: true, announcement: true, avatarUrl: true, avatarStoredName: true, joinMode: true, updatedAt: true,
          members: { where: { userId: user.id, status: ChatGroupMemberStatus.active }, select: { userId: true }, take: 1 },
          _count: { select: { members: { where: { status: ChatGroupMemberStatus.active } } } },
        },
      }),
    ]);
    return {
      topics: topics.map((topic) => ({ id: topic.id, title: topic.title, slug: topic.slug, description: topic.description, coverPath: topic.coverPath, articleCount: topic._count.items, subscriberCount: topic._count.subscribers, subscribed: false, updatedAt: topic.updatedAt.toISOString() })),
      collections: collections.map((collection) => ({ id: collection.id, name: collection.name, description: collection.description, articleCount: collection._count.items, subscriberCount: collection._count.subscribers, subscribed: false, owner: this.toAuthor(collection.owner), updatedAt: collection.updatedAt.toISOString() })),
      groups: groups.map((group) => ({ id: group.id, conversationId: group.conversationId, name: group.name, avatarUrl: group.avatarStoredName ? `/social/groups/${group.id}/avatar` : group.avatarUrl, announcement: group.announcement, memberCount: group._count.members, joinMode: group.joinMode, isMember: Boolean(group.members.length), updatedAt: group.updatedAt.toISOString() })),
    };
  }

  async subscribeTopic(user: AuthenticatedUser, topicId: number) {
    const topic = await this.prisma.articleTopic.findFirst({ where: { id: topicId, ...this.topicVisibleWhere(user) }, select: { id: true } });
    if (!topic) throw new NotFoundException("专题不存在或当前不可订阅。");
    await this.prisma.articleTopicSubscription.upsert({ where: { userId_topicId: { userId: user.id, topicId } }, create: { userId: user.id, topicId }, update: {} });
    return { subscribed: true, subscriberCount: await this.prisma.articleTopicSubscription.count({ where: { topicId } }) };
  }

  async unsubscribeTopic(user: AuthenticatedUser, topicId: number) {
    await this.prisma.articleTopicSubscription.deleteMany({ where: { userId: user.id, topicId } });
    return { subscribed: false, subscriberCount: await this.prisma.articleTopicSubscription.count({ where: { topicId } }) };
  }

  async subscribeCollection(user: AuthenticatedUser, collectionId: number) {
    const collection = await this.prisma.articleCollection.findFirst({ where: { id: collectionId, ...this.collectionVisibleWhere(user), ownerId: { not: user.id } }, select: { id: true } });
    if (!collection) throw new NotFoundException("合集不存在或当前不可订阅。");
    await this.prisma.articleCollectionSubscription.upsert({ where: { userId_collectionId: { userId: user.id, collectionId } }, create: { userId: user.id, collectionId }, update: {} });
    return { subscribed: true, subscriberCount: await this.prisma.articleCollectionSubscription.count({ where: { collectionId } }) };
  }

  async unsubscribeCollection(user: AuthenticatedUser, collectionId: number) {
    await this.prisma.articleCollectionSubscription.deleteMany({ where: { userId: user.id, collectionId } });
    return { subscribed: false, subscriberCount: await this.prisma.articleCollectionSubscription.count({ where: { collectionId } }) };
  }

  /** Subscription feed counts only currently readable published articles from active subscriptions. */
  async listSubscriptionFeed(
    user: AuthenticatedUser,
    query: ListSubscriptionFeedQueryDto,
  ): Promise<SubscriptionFeedResponse> {
    const where = this.subscriptionArticleWhere(user);
    const unreadWhere: Prisma.ArticleWhereInput = {
      AND: [where, { subscriptionFeedReads: { none: { userId: user.id } } }],
    };
    const [total, unread] = await Promise.all([
      this.prisma.article.count({ where }),
      this.prisma.article.count({ where: unreadWhere }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const skip = (page - 1) * query.pageSize;
    const include = {
      ...discoveryArticleInclude,
      subscriptionFeedReads: {
        where: { userId: user.id },
        select: { readAt: true },
      },
    } satisfies Prisma.ArticleInclude;

    let records: Array<DiscoveryArticleRecord & { subscriptionFeedReads: Array<{ readAt: Date }> }>;
    if (query.sort === "unread") {
      const unreadTake = Math.max(0, Math.min(query.pageSize, unread - skip));
      const unreadSkip = Math.min(skip, unread);
      const unreadRecords = unreadTake
        ? await this.prisma.article.findMany({
            where: unreadWhere,
            orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
            skip: unreadSkip,
            take: unreadTake,
            include,
          })
        : [];
      const remaining = query.pageSize - unreadRecords.length;
      const readSkip = Math.max(0, skip - unread);
      const readRecords = remaining
        ? await this.prisma.article.findMany({
            where: {
              AND: [where, { subscriptionFeedReads: { some: { userId: user.id } } }],
            },
            orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
            skip: readSkip,
            take: remaining,
            include,
          })
        : [];
      records = [...unreadRecords, ...readRecords];
    } else {
      records = await this.prisma.article.findMany({
        where,
        orderBy: query.sort === "popular"
          ? [
              { commentCount: "desc" },
              { favoriteCount: "desc" },
              { likeCount: "desc" },
              { viewCount: "desc" },
              { publishedAt: "desc" },
              { id: "desc" },
            ]
          : [{ publishedAt: "desc" }, { id: "desc" }],
        skip,
        take: query.pageSize,
        include,
      });
    }

    return {
      items: records.map((article) => ({
        article: this.toArticle(article, user),
        readAt: article.subscriptionFeedReads[0]?.readAt.toISOString() ?? null,
      })),
      total,
      unread,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  async markSubscriptionFeedRead(user: AuthenticatedUser, articleId: number) {
    const article = await this.prisma.article.findFirst({
      where: { AND: [this.subscriptionArticleWhere(user), { id: articleId }] },
      select: { id: true },
    });
    if (!article) throw new NotFoundException("订阅动态不存在或当前不可见。");
    const record = await this.prisma.subscriptionFeedRead.upsert({
      where: { userId_articleId: { userId: user.id, articleId } },
      create: { userId: user.id, articleId },
      update: { readAt: new Date() },
    });
    return { articleId, readAt: record.readAt.toISOString() };
  }

  async markAllSubscriptionFeedRead(user: AuthenticatedUser) {
    const articles = await this.prisma.article.findMany({
      where: this.subscriptionArticleWhere(user),
      select: { id: true },
    });
    if (articles.length) {
      await this.prisma.subscriptionFeedRead.createMany({
        data: articles.map(({ id }) => ({ userId: user.id, articleId: id })),
        skipDuplicates: true,
      });
    }
    return { count: articles.length, readAt: new Date().toISOString() };
  }

  async listContentSubscriptions(user: AuthenticatedUser) {
    const [topicSubscriptions, collectionSubscriptions] = await Promise.all([
      this.prisma.articleTopicSubscription.findMany({
        where: { userId: user.id, topic: { is: this.topicVisibleWhere(user) } },
        orderBy: [{ createdAt: "desc" }, { topicId: "desc" }],
        select: {
          createdAt: true,
          topic: {
            select: {
              id: true,
              title: true,
              slug: true,
              description: true,
              coverPath: true,
              _count: { select: { items: true, subscribers: true } },
            },
          },
        },
      }),
      this.prisma.articleCollectionSubscription.findMany({
        where: { userId: user.id, collection: { is: this.collectionVisibleWhere(user) } },
        orderBy: [{ createdAt: "desc" }, { collectionId: "desc" }],
        select: {
          createdAt: true,
          collection: {
            select: {
              id: true,
              name: true,
              description: true,
              owner: { select: discoveryArticleInclude.author.select },
              _count: { select: { items: true, subscribers: true } },
            },
          },
        },
      }),
    ]);
    return {
      topics: topicSubscriptions.map(({ createdAt, topic }) => ({
        id: topic.id,
        title: topic.title,
        slug: topic.slug,
        description: topic.description,
        coverPath: topic.coverPath,
        articleCount: topic._count.items,
        subscriberCount: topic._count.subscribers,
        subscribedAt: createdAt.toISOString(),
      })),
      collections: collectionSubscriptions.map(({ createdAt, collection }) => ({
        id: collection.id,
        name: collection.name,
        description: collection.description,
        owner: this.toAuthor(collection.owner),
        articleCount: collection._count.items,
        subscriberCount: collection._count.subscribers,
        subscribedAt: createdAt.toISOString(),
      })),
    };
  }

  async listSubscriptionSettings(user: AuthenticatedUser) {
    const items = await this.prisma.userSubscription.findMany({
      where: { subscriberId: user.id },
      orderBy: [{ createdAt: "desc" }],
      select: {
        authorId: true,
        notifyNewArticles: true,
        createdAt: true,
        author: { select: discoveryArticleInclude.author.select },
      },
    });
    return {
      items: items.map((item) => ({
        author: this.toAuthor(item.author),
        notifyNewArticles: item.notifyNewArticles,
        subscribedAt: item.createdAt.toISOString(),
      })),
    };
  }

  async updateSubscriptionSetting(
    user: AuthenticatedUser,
    authorId: number,
    notifyNewArticles: boolean,
  ) {
    const existing = await this.prisma.userSubscription.findUnique({
      where: { subscriberId_authorId: { subscriberId: user.id, authorId } },
      select: { authorId: true },
    });
    if (!existing) throw new NotFoundException("尚未订阅该作者。");
    await this.prisma.userSubscription.update({
      where: { subscriberId_authorId: { subscriberId: user.id, authorId } },
      data: { notifyNewArticles },
    });
    return { authorId, notifyNewArticles };
  }

  async listMyCollections(user: AuthenticatedUser) {
    const records = await this.prisma.articleCollection.findMany({
      where: { ownerId: user.id },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
      include: articleCollectionInclude,
    });
    return { items: records.map((record) => this.toCollection(record, user, true)) };
  }

  async createCollection(user: AuthenticatedUser, dto: CreateArticleCollectionDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException("合集名称不能为空。");
    const record = await this.prisma.articleCollection.create({
      data: {
        ownerId: user.id,
        name,
        description: dto.description?.trim() ?? "",
        coverPath: dto.coverPath?.trim() || null,
        visibility: this.collectionVisibility(dto.visibility),
      },
      include: articleCollectionInclude,
    });
    return this.toCollection(record, user, true);
  }

  async updateCollection(
    user: AuthenticatedUser,
    id: number,
    dto: UpdateArticleCollectionDto,
  ) {
    const name = dto.name?.trim();
    if (dto.name !== undefined && !name) throw new BadRequestException("合集名称不能为空。");
    const existing = await this.prisma.articleCollection.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, coverPath: true, coverStoredName: true },
    });
    if (!existing) throw new NotFoundException("合集不存在或不属于当前账号。");
    const nextCoverPath = dto.coverPath === undefined ? undefined : dto.coverPath.trim() || null;
    const replacesManagedCover = Boolean(
      existing.coverStoredName && nextCoverPath !== undefined && nextCoverPath !== existing.coverPath,
    );
    const record = await this.prisma.articleCollection.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
        ...(nextCoverPath !== undefined ? { coverPath: nextCoverPath } : {}),
        ...(replacesManagedCover ? {
          coverOriginalName: null,
          coverStoredName: null,
          coverMimeType: null,
          coverSizeBytes: null,
        } : {}),
        ...(dto.visibility !== undefined ? { visibility: this.collectionVisibility(dto.visibility) } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
      },
      include: articleCollectionInclude,
    });
    if (replacesManagedCover) await this.deleteManagedCollectionCover(existing.coverStoredName);
    return this.toCollection(record, user, true);
  }

  async uploadCollectionCover(
    user: AuthenticatedUser,
    id: number,
    file: UploadedCollectionCover | undefined,
  ) {
    if (!file) throw new BadRequestException("请选择要上传的合集封面。");
    if (file.size > TOPIC_COVER_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException("合集封面不能超过 10 MB。");
    }
    const collection = await this.prisma.articleCollection.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, coverStoredName: true },
    });
    if (!collection) throw new NotFoundException("合集不存在或不属于当前账号。");
    const format = this.validateCover(file, "合集");
    const storedName = `collection-${randomUUID()}${format.extension}`;
    const filePath = this.resolveCollectionCoverPath(storedName);
    await mkdir(this.collectionCoverDirectory, { recursive: true });
    try {
      await writeFile(filePath, file.buffer, { flag: "wx" });
      await this.prisma.articleCollection.update({
        where: { id },
        data: {
          coverPath: `${COLLECTION_COVER_PUBLIC_PREFIX}${storedName}`,
          coverOriginalName: basename(file.originalname).slice(0, 255),
          coverStoredName: storedName,
          coverMimeType: format.mimeType,
          coverSizeBytes: file.size,
        },
      });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    await this.deleteManagedCollectionCover(collection.coverStoredName);
    return this.getOwnedCollection(user, id);
  }

  async deleteCollection(user: AuthenticatedUser, id: number) {
    const collection = await this.prisma.articleCollection.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, coverStoredName: true },
    });
    if (!collection) throw new NotFoundException("合集不存在或不属于当前账号。");
    await this.prisma.articleCollection.delete({ where: { id } });
    await this.deleteManagedCollectionCover(collection.coverStoredName);
    return { success: true };
  }

  async addCollectionArticle(user: AuthenticatedUser, id: number, articleId: number) {
    await this.assertCollectionOwner(id, user.id);
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, authorId: user.id, status: { not: ArticleStatus.deleted } },
      select: { id: true },
    });
    if (!article) throw new BadRequestException("合集只能收录你自己的有效文章。");
    const count = await this.prisma.articleCollectionItem.count({ where: { collectionId: id } });
    await this.prisma.articleCollectionItem.upsert({
      where: { collectionId_articleId: { collectionId: id, articleId } },
      create: { collectionId: id, articleId, sortOrder: count },
      update: {},
    });
    return this.getOwnedCollection(user, id);
  }

  async removeCollectionArticle(user: AuthenticatedUser, id: number, articleId: number) {
    await this.assertCollectionOwner(id, user.id);
    await this.prisma.articleCollectionItem.deleteMany({ where: { collectionId: id, articleId } });
    return this.getOwnedCollection(user, id);
  }

  async reorderCollectionArticles(
    user: AuthenticatedUser,
    id: number,
    dto: ReorderContentItemsDto,
  ) {
    await this.assertCollectionOwner(id, user.id);
    await this.assertExactItemSet("collection", id, dto.ids);
    await this.prisma.$transaction(
      dto.ids.map((articleId, sortOrder) => this.prisma.articleCollectionItem.update({
        where: { collectionId_articleId: { collectionId: id, articleId } },
        data: { sortOrder },
      })),
    );
    return this.getOwnedCollection(user, id);
  }

  async getCollection(id: number, viewer: AuthenticatedUser | null) {
    const record = await this.prisma.articleCollection.findFirst({
      where: { id, ...this.collectionVisibleWhere(viewer) },
      include: articleCollectionInclude,
    });
    if (!record) throw new NotFoundException("合集不存在或当前不可见。");
    const subscribed = viewer ? Boolean(await this.prisma.articleCollectionSubscription.findUnique({
      where: { userId_collectionId: { userId: viewer.id, collectionId: id } },
      select: { userId: true },
    })) : false;
    return this.toCollection(record, viewer, record.ownerId === viewer?.id, subscribed);
  }

  async listCollections(query: ListCollectionsQueryDto, viewer: AuthenticatedUser | null) {
    const keyword = query.q.trim();
    const where: Prisma.ArticleCollectionWhereInput = {
      AND: [
        this.collectionVisibleWhere(viewer),
        ...(keyword ? [{
          OR: [
            { name: { contains: keyword } },
            { description: { contains: keyword } },
            { owner: { is: { nickname: { contains: keyword } } } },
            { owner: { is: { username: { contains: keyword } } } },
          ],
        }] : []),
      ],
    };
    const total = await this.prisma.articleCollection.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const records = await this.prisma.articleCollection.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * query.pageSize,
      take: query.pageSize,
      include: articleCollectionInclude,
    });
    const subscribedIds = new Set(viewer && records.length ? (await this.prisma.articleCollectionSubscription.findMany({
      where: { userId: viewer.id, collectionId: { in: records.map(({ id }) => id) } },
      select: { collectionId: true },
    })).map(({ collectionId }) => collectionId) : []);
    return {
      items: records.map((record) => this.toCollection(record, viewer, record.ownerId === viewer?.id, subscribedIds.has(record.id))),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  async listTopics(query: ListDiscoveryQueryDto, viewer: AuthenticatedUser | null) {
    const keyword = query.q?.trim();
    const visibleWhere = this.topicVisibleWhere(viewer);
    const where: Prisma.ArticleTopicWhereInput = keyword ? {
      AND: [
        visibleWhere,
        { OR: [{ title: { contains: keyword } }, { description: { contains: keyword } }] },
      ],
    } : visibleWhere;
    const total = await this.prisma.articleTopic.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
    const page = Math.min(query.page, totalPages);
    const records = await this.prisma.articleTopic.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * query.pageSize,
      take: query.pageSize,
      include: articleTopicInclude,
    });
    const subscribedIds = new Set(viewer && records.length ? (await this.prisma.articleTopicSubscription.findMany({
      where: { userId: viewer.id, topicId: { in: records.map(({ id }) => id) } },
      select: { topicId: true },
    })).map(({ topicId }) => topicId) : []);
    return {
      items: records.map((record) => this.toTopic(record, viewer, false, subscribedIds.has(record.id))),
      total,
      page,
      pageSize: query.pageSize,
      totalPages,
    };
  }

  async getTopic(slug: string, viewer: AuthenticatedUser | null) {
    const record = await this.prisma.articleTopic.findFirst({
      where: { slug: slug.trim(), ...this.topicVisibleWhere(viewer) },
      include: articleTopicInclude,
    });
    if (!record) throw new NotFoundException("专题不存在或当前不可见。");
    const subscribed = viewer ? Boolean(await this.prisma.articleTopicSubscription.findUnique({
      where: { userId_topicId: { userId: viewer.id, topicId: record.id } },
      select: { userId: true },
    })) : false;
    return this.toTopic(record, viewer, false, subscribed);
  }

  async listAdminTopics(user: AuthenticatedUser) {
    this.assertCanManage(user);
    const records = await this.prisma.articleTopic.findMany({
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }, { id: "desc" }],
      include: articleTopicInclude,
    });
    return { items: records.map((record) => this.toTopic(record, user, true)) };
  }

  async uploadTopicCover(
    user: AuthenticatedUser,
    id: number,
    file: UploadedTopicCover | undefined,
  ) {
    this.assertCanManage(user);
    if (!file) throw new BadRequestException("请选择要上传的专题封面。");
    if (file.size > TOPIC_COVER_MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException("专题封面不能超过 10 MB。");
    }
    const topic = await this.prisma.articleTopic.findUnique({
      where: { id },
      select: { id: true, coverStoredName: true },
    });
    if (!topic) throw new NotFoundException("专题不存在。");
    const format = this.validateTopicCover(file);
    const storedName = `topic-${randomUUID()}${format.extension}`;
    const filePath = this.resolveTopicCoverPath(storedName);
    await mkdir(this.topicCoverDirectory, { recursive: true });
    try {
      await writeFile(filePath, file.buffer, { flag: "wx" });
      await this.prisma.articleTopic.update({
        where: { id },
        data: {
          coverPath: `${TOPIC_COVER_PUBLIC_PREFIX}${storedName}`,
          coverOriginalName: basename(file.originalname).slice(0, 255),
          coverStoredName: storedName,
          coverMimeType: format.mimeType,
          coverSizeBytes: file.size,
          updatedById: user.id,
        },
      });
    } catch (error) {
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
    await this.deleteManagedTopicCover(topic.coverStoredName);
    return this.getAdminTopic(user, id);
  }

  async getTopicCover(storedName: string): Promise<{ filePath: string; mimeType: string; sizeBytes: number }> {
    const filePath = this.resolveTopicCoverPath(storedName);
    const topic = await this.prisma.articleTopic.findUnique({
      where: { coverStoredName: storedName },
      select: { coverMimeType: true, coverSizeBytes: true },
    });
    if (!topic?.coverMimeType || topic.coverSizeBytes === null) {
      throw new NotFoundException("专题封面不存在。");
    }
    try {
      await access(filePath);
    } catch {
      throw new NotFoundException("专题封面文件不存在。");
    }
    return { filePath, mimeType: topic.coverMimeType, sizeBytes: topic.coverSizeBytes };
  }

  async getCollectionCover(storedName: string): Promise<{ filePath: string; mimeType: string; sizeBytes: number }> {
    const filePath = this.resolveCollectionCoverPath(storedName);
    const collection = await this.prisma.articleCollection.findUnique({
      where: { coverStoredName: storedName },
      select: { coverMimeType: true, coverSizeBytes: true },
    });
    if (!collection?.coverMimeType || collection.coverSizeBytes === null) {
      throw new NotFoundException("合集封面不存在。");
    }
    try {
      await access(filePath);
    } catch {
      throw new NotFoundException("合集封面文件不存在。");
    }
    return { filePath, mimeType: collection.coverMimeType, sizeBytes: collection.coverSizeBytes };
  }

  async createTopic(user: AuthenticatedUser, dto: CreateArticleTopicDto) {
    this.assertCanManage(user);
    const title = dto.title.trim();
    if (!title) throw new BadRequestException("专题名称不能为空。");
    const visibility = this.topicVisibility(dto.visibility);
    const roleIds = await this.resolveTopicRoleIds(visibility, dto.roleCodes ?? []);
    const record = await this.prisma.articleTopic.create({
      data: {
        title,
        slug: await this.uniqueTopicSlug(dto.slug || title),
        description: dto.description?.trim() ?? "",
        coverPath: dto.coverPath?.trim() || null,
        visibility,
        status: dto.status === "disabled" ? ArticleTopicStatus.disabled : ArticleTopicStatus.active,
        sortOrder: dto.sortOrder ?? 0,
        createdById: user.id,
        updatedById: user.id,
        allowedRoles: { create: roleIds.map((roleId) => ({ roleId })) },
      },
      include: articleTopicInclude,
    });
    return this.toTopic(record, user, true);
  }

  async updateTopic(user: AuthenticatedUser, id: number, dto: UpdateArticleTopicDto) {
    this.assertCanManage(user);
    const existing = await this.prisma.articleTopic.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        visibility: true,
        coverPath: true,
        coverStoredName: true,
        allowedRoles: { select: { role: { select: { code: true } } } },
      },
    });
    if (!existing) throw new NotFoundException("专题不存在。");
    const visibility = dto.visibility ? this.topicVisibility(dto.visibility) : existing.visibility;
    const roleIds = await this.resolveTopicRoleIds(
      visibility,
      dto.roleCodes ?? existing.allowedRoles.map(({ role }) => role.code),
    );
    const title = dto.title?.trim();
    if (dto.title !== undefined && !title) throw new BadRequestException("专题名称不能为空。");
    const nextCoverPath = dto.coverPath === undefined ? undefined : dto.coverPath.trim() || null;
    const replacesManagedCover = Boolean(
      existing.coverStoredName && nextCoverPath !== undefined && nextCoverPath !== existing.coverPath,
    );
    const record = await this.prisma.$transaction(async (transaction) => {
      await transaction.articleTopicAllowedRole.deleteMany({ where: { topicId: id } });
      return transaction.articleTopic.update({
        where: { id },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(dto.slug !== undefined ? { slug: await this.uniqueTopicSlug(dto.slug || title || existing.title, id) } : {}),
          ...(dto.description !== undefined ? { description: dto.description.trim() } : {}),
          ...(nextCoverPath !== undefined ? { coverPath: nextCoverPath } : {}),
          ...(replacesManagedCover ? {
            coverOriginalName: null,
            coverStoredName: null,
            coverMimeType: null,
            coverSizeBytes: null,
          } : {}),
          visibility,
          ...(dto.status !== undefined ? { status: dto.status as ArticleTopicStatus } : {}),
          ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
          updatedById: user.id,
          allowedRoles: { create: roleIds.map((roleId) => ({ roleId })) },
        },
        include: articleTopicInclude,
      });
    });
    if (replacesManagedCover) await this.deleteManagedTopicCover(existing.coverStoredName);
    return this.toTopic(record, user, true);
  }

  async deleteTopic(user: AuthenticatedUser, id: number) {
    this.assertCanManage(user);
    const topic = await this.prisma.articleTopic.findUnique({ where: { id }, select: { coverStoredName: true } });
    if (!topic) throw new NotFoundException("专题不存在。");
    await this.prisma.articleTopic.delete({ where: { id } });
    await this.deleteManagedTopicCover(topic.coverStoredName);
    return { success: true };
  }

  async addTopicArticle(user: AuthenticatedUser, id: number, articleId: number) {
    this.assertCanManage(user);
    await this.assertTopic(id);
    const article = await this.prisma.article.findFirst({
      where: { id: articleId, status: { not: ArticleStatus.deleted } },
      select: { id: true },
    });
    if (!article) throw new BadRequestException("文章不存在或已删除。");
    const count = await this.prisma.articleTopicItem.count({ where: { topicId: id } });
    await this.prisma.articleTopicItem.upsert({
      where: { topicId_articleId: { topicId: id, articleId } },
      create: { topicId: id, articleId, sortOrder: count },
      update: {},
    });
    return this.getAdminTopic(user, id);
  }

  async removeTopicArticle(user: AuthenticatedUser, id: number, articleId: number) {
    this.assertCanManage(user);
    await this.assertTopic(id);
    await this.prisma.articleTopicItem.deleteMany({ where: { topicId: id, articleId } });
    return this.getAdminTopic(user, id);
  }

  async reorderTopicArticles(user: AuthenticatedUser, id: number, dto: ReorderContentItemsDto) {
    this.assertCanManage(user);
    await this.assertTopic(id);
    await this.assertExactItemSet("topic", id, dto.ids);
    await this.prisma.$transaction(
      dto.ids.map((articleId, sortOrder) => this.prisma.articleTopicItem.update({
        where: { topicId_articleId: { topicId: id, articleId } },
        data: { sortOrder },
      })),
    );
    return this.getAdminTopic(user, id);
  }

  async getProfileSettings(user: AuthenticatedUser): Promise<ProfileSettingsResponse> {
    const settings = await this.prisma.userProfileSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id },
      update: {},
    });
    return this.toProfileSettings(settings);
  }

  async updateProfileSettings(user: AuthenticatedUser, dto: UpdateProfileSettingsDto) {
    const pinnedArticleId = dto.pinnedArticleId === undefined ? undefined : dto.pinnedArticleId || null;
    const pinnedCollectionId = dto.pinnedCollectionId === undefined ? undefined : dto.pinnedCollectionId || null;
    if (pinnedArticleId) {
      const article = await this.prisma.article.findFirst({
        where: { id: pinnedArticleId, authorId: user.id, status: ArticleStatus.published },
        select: { id: true },
      });
      if (!article) throw new BadRequestException("代表文章必须是你已发布的文章。");
    }
    if (pinnedCollectionId) {
      const collection = await this.prisma.articleCollection.findFirst({
        where: { id: pinnedCollectionId, ownerId: user.id },
        select: { id: true },
      });
      if (!collection) throw new BadRequestException("代表合集必须属于当前账号。");
    }
    const settings = await this.prisma.userProfileSettings.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        ...dto,
        ...(pinnedArticleId !== undefined ? { pinnedArticleId } : {}),
        ...(pinnedCollectionId !== undefined ? { pinnedCollectionId } : {}),
      },
      update: {
        ...dto,
        ...(pinnedArticleId !== undefined ? { pinnedArticleId } : {}),
        ...(pinnedCollectionId !== undefined ? { pinnedCollectionId } : {}),
      },
    });
    return this.toProfileSettings(settings);
  }

  /** Profile visits are daily-deduplicated hashes; raw IP addresses and user agents are never stored. */
  async getProfileShowcase(
    username: string,
    viewer: AuthenticatedUser | null,
    visitorKey: string,
  ): Promise<ProfileShowcaseResponse> {
    const target = await this.prisma.user.findUnique({
      where: { username: username.trim() },
      select: { id: true, status: true, profileSettings: true },
    });
    if (!target || target.status !== UserStatus.active) throw new NotFoundException("用户不存在或已停用。");
    const settings = target.profileSettings ?? this.defaultProfileSettings(target.id);
    await this.assertProfileVisible(target.id, settings.profileAccess, viewer);
    if (target.id !== viewer?.id) {
      await this.prisma.profileVisit.upsert({
        where: {
          profileUserId_visitorKey_visitedOn: {
            profileUserId: target.id,
            visitorKey,
            visitedOn: new Date().toISOString().slice(0, 10),
          },
        },
        create: {
          profileUserId: target.id,
          visitorKey,
          visitedOn: new Date().toISOString().slice(0, 10),
        },
        update: {},
      });
    }
    const collections = await this.prisma.articleCollection.findMany({
      where: { ownerId: target.id, ...this.collectionVisibleWhere(viewer) },
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      take: 12,
      include: articleCollectionInclude,
    });
    const [visitCount, pinnedArticle, pinnedCollection] = await Promise.all([
      settings.showStats
        ? this.prisma.profileVisit.count({ where: { profileUserId: target.id } })
        : Promise.resolve(null),
      settings.showPinnedContent && settings.pinnedArticleId
        ? this.prisma.article.findFirst({
            where: { id: settings.pinnedArticleId, ...this.articleVisibleWhere(viewer) },
            include: discoveryArticleInclude,
          })
        : Promise.resolve(null),
      settings.showPinnedContent && settings.pinnedCollectionId
        ? this.prisma.articleCollection.findFirst({
            where: { id: settings.pinnedCollectionId, ...this.collectionVisibleWhere(viewer) },
            include: articleCollectionInclude,
          })
        : Promise.resolve(null),
    ]);
    return {
      settings: this.toProfileSettings(settings),
      visitCount,
      pinnedArticle: pinnedArticle ? this.toArticle(pinnedArticle, viewer) : null,
      pinnedCollection: pinnedCollection ? this.toCollection(pinnedCollection, viewer, false) : null,
      collections: collections.map((record) => this.toCollection(record, viewer, false)),
    };
  }

  createVisitorKey(userAgent: string, ip: string, viewerId?: number): string {
    const source = viewerId ? `user:${viewerId}` : `guest:${ip}:${userAgent}`;
    return createHash("sha256").update(source).digest("hex");
  }

  private subscriptionArticleWhere(user: AuthenticatedUser): Prisma.ArticleWhereInput {
    return {
      AND: [
        this.articleVisibleWhere(user),
        {
          OR: [
            { author: { is: { subscriptionsReceived: { some: { subscriberId: user.id } } } } },
            {
              collectionItems: {
                some: {
                  collection: {
                    is: {
                      AND: [
                        this.collectionVisibleWhere(user),
                        { subscribers: { some: { userId: user.id } } },
                      ],
                    },
                  },
                },
              },
            },
            {
              topicItems: {
                some: {
                  topic: {
                    is: {
                      AND: [
                        this.topicVisibleWhere(user),
                        { subscribers: { some: { userId: user.id } } },
                      ],
                    },
                  },
                },
              },
            },
          ],
        },
      ],
    };
  }

  private articleVisibleWhere(user: AuthenticatedUser | null): Prisma.ArticleWhereInput {
    const base: Prisma.ArticleWhereInput = { status: ArticleStatus.published };
    if (!user) return { ...base, visibility: ArticleVisibility.public };
    if (user.isSuperAdmin) return base;
    return {
      ...base,
      OR: [
        { visibility: ArticleVisibility.public },
        { visibility: ArticleVisibility.authenticated },
        { visibility: ArticleVisibility.private, authorId: user.id },
        {
          visibility: ArticleVisibility.role_restricted,
          allowedRoles: { some: { role: { code: user.role.code } } },
        },
      ],
    };
  }

  private collectionVisibleWhere(user: AuthenticatedUser | null): Prisma.ArticleCollectionWhereInput {
    if (!user) return { visibility: ArticleVisibility.public };
    if (user.isSuperAdmin) return {};
    return {
      OR: [
        { visibility: ArticleVisibility.public },
        { visibility: ArticleVisibility.authenticated },
        { visibility: ArticleVisibility.private, ownerId: user.id },
      ],
    };
  }

  private topicVisibleWhere(user: AuthenticatedUser | null): Prisma.ArticleTopicWhereInput {
    const base = { status: ArticleTopicStatus.active };
    if (!user) return { ...base, visibility: PortalVisibility.public };
    if (user.isSuperAdmin) return base;
    return {
      ...base,
      OR: [
        { visibility: PortalVisibility.public },
        { visibility: PortalVisibility.authenticated },
        {
          visibility: PortalVisibility.role_restricted,
          allowedRoles: { some: { role: { code: user.role.code } } },
        },
      ],
    };
  }

  private canReadArticle(article: DiscoveryArticleRecord, user: AuthenticatedUser | null): boolean {
    if (article.status !== ArticleStatus.published) return Boolean(user && (user.isSuperAdmin || article.authorId === user.id));
    if (article.visibility === ArticleVisibility.public || user?.isSuperAdmin) return true;
    if (!user) return false;
    if (article.visibility === ArticleVisibility.authenticated) return true;
    if (article.visibility === ArticleVisibility.private) return article.authorId === user.id;
    return article.allowedRoles.some(({ role }) => role.code === user.role.code);
  }

  private canSeeCollectionLink(
    collection: DiscoveryArticleRecord["collectionItems"][number]["collection"],
    user: AuthenticatedUser | null,
  ): boolean {
    if (collection.visibility === ArticleVisibility.public || user?.isSuperAdmin) return true;
    if (!user) return false;
    return collection.visibility === ArticleVisibility.authenticated || collection.ownerId === user.id;
  }

  private canSeeTopicLink(
    topic: DiscoveryArticleRecord["topicItems"][number]["topic"],
    user: AuthenticatedUser | null,
  ): boolean {
    if (topic.status !== ArticleTopicStatus.active && !this.canManage(user)) return false;
    if (topic.visibility === PortalVisibility.public || user?.isSuperAdmin) return true;
    if (!user) return false;
    if (topic.visibility === PortalVisibility.authenticated) return true;
    return topic.allowedRoles.some(({ role }) => role.code === user.role.code);
  }

  private toArticle(article: DiscoveryArticleRecord, viewer: AuthenticatedUser | null): DiscoveryArticleResponse {
    return {
      id: article.id,
      title: article.title,
      slug: article.slug,
      category: article.category,
      tags: article.tags.split(",").filter(Boolean),
      titleColor: article.titleColor,
      coverPath: article.coverPath,
      viewCount: article.viewCount,
      likeCount: article.likeCount,
      favoriteCount: article.favoriteCount,
      commentCount: article.commentCount,
      publishedAt: article.publishedAt?.toISOString() ?? null,
      author: this.toAuthor(article.author),
      collections: article.collectionItems
        .filter(({ collection }) => this.canSeeCollectionLink(collection, viewer))
        .map(({ collection }) => ({ id: collection.id, label: collection.name, href: `/collections/${collection.id}` })),
      topics: article.topicItems
        .filter(({ topic }) => this.canSeeTopicLink(topic, viewer))
        .map(({ topic }) => ({ id: topic.id, label: topic.title, href: `/topics/${topic.slug}` })),
    };
  }

  private toCollection(
    collection: ArticleCollectionRecord,
    viewer: AuthenticatedUser | null,
    ownerView: boolean,
    subscribed = false,
  ): ArticleCollectionResponse {
    const articles = collection.items
      .map(({ article }) => article)
      .filter((article) => ownerView || this.canReadArticle(article, viewer))
      .map((article) => this.toArticle(article, viewer));
    return {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      coverPath: collection.coverPath,
      visibility: collection.visibility as ArticleCollectionResponse["visibility"],
      sortOrder: collection.sortOrder,
      owner: this.toAuthor(collection.owner),
      articles,
      articleCount: articles.length,
      subscriberCount: collection._count.subscribers,
      subscribed,
      createdAt: collection.createdAt.toISOString(),
      updatedAt: collection.updatedAt.toISOString(),
    };
  }

  private toTopic(
    topic: ArticleTopicRecord,
    viewer: AuthenticatedUser | null,
    managerView: boolean,
    subscribed = false,
  ): ArticleTopicResponse {
    const articles = topic.items
      .map(({ article }) => article)
      .filter((article) => managerView || this.canReadArticle(article, viewer))
      .map((article) => this.toArticle(article, viewer));
    return {
      id: topic.id,
      title: topic.title,
      slug: topic.slug,
      description: topic.description,
      coverPath: topic.coverPath,
      visibility: topic.visibility,
      status: topic.status,
      sortOrder: topic.sortOrder,
      roleCodes: topic.allowedRoles.map(({ role }) => role.code),
      articles,
      articleCount: articles.length,
      subscriberCount: topic._count.subscribers,
      subscribed,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
    };
  }

  private toAuthor(author: {
    id: number;
    nickname: string;
    username: string;
    avatarStoredName: string | null;
    isSuperAdmin: boolean;
    isAdministrator: boolean;
    role: { code: string; name: string; level: number };
  }): DiscoveryAuthorResponse {
    return {
      id: author.id,
      nickname: author.nickname || author.username,
      username: author.username,
      avatarUrl: author.avatarStoredName ? `/auth/avatars/${author.avatarStoredName}` : null,
      isSuperAdmin: author.isSuperAdmin,
      isAdministrator: author.isAdministrator,
      role: {
        ...author.role,
        name: author.role.name,
      },
    };
  }

  private toProfileSettings(settings: {
    profileAccess: ProfileAccessLevel;
    searchable: boolean;
    friendRequestPolicy: FriendRequestPolicy;
    directMessagePolicy: DirectMessagePolicy;
    groupInvitationPolicy: GroupInvitationPolicy;
    showBio: boolean;
    showJoinedAt: boolean;
    showStats: boolean;
    showFollowingCount: boolean;
    showPinnedContent: boolean;
    pinnedArticleId: number | null;
    pinnedCollectionId: number | null;
  }): ProfileSettingsResponse {
    return {
      profileAccess: settings.profileAccess,
      searchable: settings.searchable,
      friendRequestPolicy: settings.friendRequestPolicy,
      directMessagePolicy: settings.directMessagePolicy,
      groupInvitationPolicy: settings.groupInvitationPolicy,
      showBio: settings.showBio,
      showJoinedAt: settings.showJoinedAt,
      showStats: settings.showStats,
      showFollowingCount: settings.showFollowingCount,
      showPinnedContent: settings.showPinnedContent,
      pinnedArticleId: settings.pinnedArticleId,
      pinnedCollectionId: settings.pinnedCollectionId,
    };
  }

  private defaultProfileSettings(userId: number) {
    return {
      userId,
      profileAccess: ProfileAccessLevel.public,
      searchable: true,
      friendRequestPolicy: FriendRequestPolicy.everyone,
      directMessagePolicy: DirectMessagePolicy.request,
      groupInvitationPolicy: GroupInvitationPolicy.everyone,
      showBio: true,
      showJoinedAt: true,
      showStats: true,
      showFollowingCount: true,
      showPinnedContent: true,
      pinnedArticleId: null,
      pinnedCollectionId: null,
      updatedAt: new Date(0),
    };
  }

  private async assertProfileVisible(
    targetId: number,
    accessLevel: ProfileAccessLevel,
    viewer: AuthenticatedUser | null,
  ): Promise<void> {
    if (viewer?.id === targetId) return;
    if (accessLevel === ProfileAccessLevel.public && !viewer) return;
    if (!viewer) throw new ForbiddenException("当前主页仅登录用户可见。");

    const relationship = await this.prisma.friendship.findFirst({
      where: {
        OR: [
          { userOneId: viewer.id, userTwoId: targetId },
          { userOneId: targetId, userTwoId: viewer.id },
        ],
      },
      select: { status: true },
    });
    if (relationship?.status === FriendshipStatus.blocked) {
      throw new ForbiddenException("当前主页不可访问。");
    }
    if (accessLevel === ProfileAccessLevel.public || accessLevel === ProfileAccessLevel.authenticated) return;
    if (accessLevel === ProfileAccessLevel.friends && relationship?.status === FriendshipStatus.accepted) return;
    throw new ForbiddenException("当前主页仅对好友开放。");
  }

  private async getOwnedCollection(user: AuthenticatedUser, id: number) {
    const record = await this.prisma.articleCollection.findFirst({
      where: { id, ownerId: user.id },
      include: articleCollectionInclude,
    });
    if (!record) throw new NotFoundException("合集不存在。");
    return this.toCollection(record, user, true);
  }

  private async getAdminTopic(user: AuthenticatedUser, id: number) {
    const record = await this.prisma.articleTopic.findUnique({
      where: { id },
      include: articleTopicInclude,
    });
    if (!record) throw new NotFoundException("专题不存在。");
    return this.toTopic(record, user, true);
  }

  private async assertCollectionOwner(id: number, ownerId: number) {
    const collection = await this.prisma.articleCollection.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    if (!collection) throw new NotFoundException("合集不存在或不属于当前账号。");
  }

  private async assertTopic(id: number) {
    const topic = await this.prisma.articleTopic.findUnique({ where: { id }, select: { id: true } });
    if (!topic) throw new NotFoundException("专题不存在。");
  }

  private async assertExactItemSet(kind: "collection" | "topic", id: number, ids: number[]) {
    const records = kind === "collection"
      ? await this.prisma.articleCollectionItem.findMany({ where: { collectionId: id }, select: { articleId: true } })
      : await this.prisma.articleTopicItem.findMany({ where: { topicId: id }, select: { articleId: true } });
    const current = records.map(({ articleId }) => articleId).sort((a, b) => a - b);
    const requested = [...ids].sort((a, b) => a - b);
    if (current.length !== requested.length || current.some((value, index) => value !== requested[index])) {
      throw new BadRequestException("排序列表必须包含当前全部文章且不能重复。");
    }
  }

  private validateCover(file: UploadedTopicCover, label: "专题" | "合集"): SupportedTopicCoverFormat {
    const mimeType = file.mimetype.toLowerCase();
    const extension = extname(file.originalname).toLowerCase();
    const format = TOPIC_COVER_FORMATS.find((candidate) => candidate.matches(file.buffer));
    if (!format || mimeType !== format.mimeType || !format.extensions.includes(extension)) {
      throw new BadRequestException(`${label}封面只支持有效的 JPEG、PNG、WebP 或 AVIF 图片。`);
    }
    return format;
  }

  private validateTopicCover(file: UploadedTopicCover): SupportedTopicCoverFormat {
    return this.validateCover(file, "专题");
  }

  private resolveTopicCoverPath(storedName: string): string {
    if (!/^topic-[0-9a-f-]{36}\.(?:jpg|png|webp|avif)$/i.test(storedName) || basename(storedName) !== storedName) {
      throw new NotFoundException("专题封面不存在。");
    }
    const filePath = resolve(this.topicCoverDirectory, storedName);
    const prefix = `${this.topicCoverDirectory}${process.platform === "win32" ? "\\" : "/"}`;
    if (!filePath.startsWith(prefix)) throw new NotFoundException("专题封面不存在。");
    return filePath;
  }

  private async deleteManagedTopicCover(storedName: string | null): Promise<void> {
    if (!storedName) return;
    await unlink(this.resolveTopicCoverPath(storedName)).catch(() => undefined);
  }

  private resolveCollectionCoverPath(storedName: string): string {
    if (!/^collection-[0-9a-f-]{36}\.(?:jpg|png|webp|avif)$/i.test(storedName) || basename(storedName) !== storedName) {
      throw new NotFoundException("合集封面不存在。");
    }
    const filePath = resolve(this.collectionCoverDirectory, storedName);
    const prefix = `${this.collectionCoverDirectory}${process.platform === "win32" ? "\\" : "/"}`;
    if (!filePath.startsWith(prefix)) throw new NotFoundException("合集封面不存在。");
    return filePath;
  }

  private async deleteManagedCollectionCover(storedName: string | null): Promise<void> {
    if (!storedName) return;
    await unlink(this.resolveCollectionCoverPath(storedName)).catch(() => undefined);
  }

  private collectionVisibility(value?: "public" | "authenticated" | "private"): ArticleVisibility {
    if (value === "authenticated") return ArticleVisibility.authenticated;
    if (value === "private") return ArticleVisibility.private;
    return ArticleVisibility.public;
  }

  private topicVisibility(value?: "public" | "authenticated" | "role_restricted"): PortalVisibility {
    if (value === "authenticated") return PortalVisibility.authenticated;
    if (value === "role_restricted") return PortalVisibility.role_restricted;
    return PortalVisibility.public;
  }

  private async resolveTopicRoleIds(visibility: PortalVisibility, roleCodes: string[]): Promise<number[]> {
    if (visibility !== PortalVisibility.role_restricted) return [];
    const codes = [...new Set(roleCodes.map((code) => code.trim()).filter(Boolean))];
    if (!codes.length) throw new BadRequestException("指定角色专题至少选择一个角色。");
    const roles = await this.prisma.role.findMany({ where: { code: { in: codes } }, select: { id: true, code: true } });
    if (roles.length !== codes.length) throw new BadRequestException("包含不存在的角色代码。");
    return roles.map(({ id }) => id);
  }

  private async uniqueTopicSlug(value: string, excludeId?: number): Promise<string> {
    const base = value.trim().toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 100) || `topic-${randomUUID().slice(0, 8)}`;
    let slug = base;
    let attempt = 1;
    while (await this.prisma.articleTopic.findFirst({
      where: { slug, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    })) {
      slug = `${base.slice(0, 108)}-${attempt++}`;
    }
    return slug;
  }

  private canManage(user: AuthenticatedUser | null): boolean {
    return Boolean(user && (user.isSuperAdmin || user.isAdministrator));
  }

  private assertCanManage(user: AuthenticatedUser): void {
    if (!this.canManage(user)) throw new ForbiddenException("需要管理员权限。");
  }
}
