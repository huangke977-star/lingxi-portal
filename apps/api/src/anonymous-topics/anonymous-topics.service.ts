import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import { createHash } from "node:crypto";
import { AnonymousTopicReactionValue, AnonymousTopicStatus, Prisma } from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PasswordService } from "../auth/password.service";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import {
  ClaimAnonymousIdentityDto,
  CreateAnonymousMessageDto,
  CreateAnonymousTopicDto,
  FavoriteAnonymousTopicDto,
  GetAnonymousTopicQueryDto,
  ListAnonymousTopicsQueryDto,
  ReactAnonymousMessageDto,
  UpdateAnonymousMessageDto,
  UpdateAnonymousTopicByCreatorDto,
  UpdateAnonymousTopicDto,
} from "./dto/anonymous-topic.dto";

interface IdentityPayload { topicId: number; identityId: number; kind: "anonymous-topic"; }

const messageInclude = { identity: { select: { id: true, nickname: true } } } satisfies Prisma.AnonymousTopicMessageInclude;

type MessageRecord = Prisma.AnonymousTopicMessageGetPayload<{ include: typeof messageInclude }>;

@Injectable()
export class AnonymousTopicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
    private readonly jwtService: JwtService,
    private readonly redis: RedisService,
  ) {}

  async list(query: ListAnonymousTopicsQueryDto, visitorKey?: string) {
    const keyword = query.q?.trim();
    const where: Prisma.AnonymousTopicWhereInput = {
      isHidden: false,
      ...(keyword ? { title: { contains: keyword } } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.anonymousTopic.count({ where }),
      this.prisma.anonymousTopic.findMany({
        where,
        orderBy: this.topicOrder(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: await this.toTopicSummaries(items, visitorKey),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async listAdmin(user: AuthenticatedUser, query: ListAnonymousTopicsQueryDto) {
    this.assertManager(user);
    const keyword = query.q?.trim();
    const where: Prisma.AnonymousTopicWhereInput = keyword ? { title: { contains: keyword } } : {};
    const [total, items] = await Promise.all([
      this.prisma.anonymousTopic.count({ where }),
      this.prisma.anonymousTopic.findMany({
        where,
        orderBy: this.topicOrder(query.sort),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: await this.toTopicSummaries(items),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async get(id: number, query: GetAnonymousTopicQueryDto, visitorKey?: string) {
    const topic = await this.prisma.anonymousTopic.findFirst({ where: { id, isHidden: false } });
    if (!topic) throw new NotFoundException("话题不存在或已隐藏。");
    const messages = await this.prisma.anonymousTopicMessage.findMany({
      where: { topicId: id, isHidden: false, ...(query.beforeSequence ? { sequence: { lt: query.beforeSequence } } : {}) },
      orderBy: { sequence: "desc" },
      take: query.limit + 1,
      include: messageInclude,
    });
    const hasMore = messages.length > query.limit;
    return {
      ...this.toTopicSummary(topic, { favorited: await this.isTopicFavorited(id, visitorKey) }),
      messages: messages.slice(0, query.limit).reverse().map((message) => this.toMessage(message)),
      hasMore,
    };
  }

  async getAdmin(user: AuthenticatedUser, id: number, query: GetAnonymousTopicQueryDto) {
    this.assertManager(user);
    const topic = await this.prisma.anonymousTopic.findUnique({ where: { id } });
    if (!topic) throw new NotFoundException("话题不存在。");
    const messages = await this.prisma.anonymousTopicMessage.findMany({
      where: { topicId: id, ...(query.beforeSequence ? { sequence: { lt: query.beforeSequence } } : {}) },
      orderBy: { sequence: "desc" },
      take: query.limit + 1,
      include: messageInclude,
    });
    const hasMore = messages.length > query.limit;
    return {
      ...this.toTopicSummary(topic),
      messages: messages.slice(0, query.limit).reverse().map((message) => this.toMessage(message)),
      hasMore,
    };
  }

  async create(dto: CreateAnonymousTopicDto) {
    const title = dto.title.trim();
    const nickname = dto.nickname.trim();
    this.assertAnonymousInput(title, nickname, dto.password, dto.visitorKey);
    await this.assertRateLimit("topic", dto.visitorKey, 3, 10 * 60);
    const passwordHash = await this.passwordService.hashPassword(dto.password);
    const { topic, identity } = await this.prisma.$transaction(async (transaction) => {
      const topic = await transaction.anonymousTopic.create({ data: { title } });
      const identity = await transaction.anonymousTopicIdentity.create({
        data: { topicId: topic.id, nickname, passwordHash, isCreator: true },
      });
      return { topic, identity };
    });
    return {
      ...this.toTopicSummary(topic),
      identityToken: await this.signIdentity(topic.id, identity.id),
      nickname: identity.nickname,
      isCreator: true,
    };
  }

  async claimIdentity(topicId: number, dto: ClaimAnonymousIdentityDto) {
    const topic = await this.prisma.anonymousTopic.findFirst({ where: { id: topicId, isHidden: false } });
    if (!topic) throw new NotFoundException("话题不存在或已隐藏。");
    this.assertVisitorKey(dto.visitorKey);
    if (dto.password.length < 6) throw new BadRequestException("密码至少需要 6 位。");
    await this.assertRateLimit("identity", dto.visitorKey, 10, 10 * 60);

    if (!dto.create) {
      const identities = await this.prisma.anonymousTopicIdentity.findMany({ where: { topicId } });
      for (const identity of identities) {
        if (await this.passwordService.verifyPassword(dto.password, identity.passwordHash)) {
          return { identityToken: await this.signIdentity(topicId, identity.id), nickname: identity.nickname, isCreator: identity.isCreator };
        }
      }
      throw new UnauthorizedException("未找到与该密码绑定的昵称。");
    }

    const nickname = dto.nickname?.trim() ?? "";
    if (!nickname) throw new BadRequestException("创建昵称时请填写昵称。");
    const existing = await this.prisma.anonymousTopicIdentity.findUnique({ where: { topicId_nickname: { topicId, nickname } } });
    if (existing) {
      if (await this.passwordService.verifyPassword(dto.password, existing.passwordHash)) {
        return { identityToken: await this.signIdentity(topicId, existing.id), nickname: existing.nickname, isCreator: existing.isCreator };
      }
      throw new ConflictException("该昵称已经绑定其他密码，请更换昵称。");
    }
    const identities = await this.prisma.anonymousTopicIdentity.findMany({ where: { topicId } });
    let passwordBoundIdentity: typeof identities[number] | null = null;
    for (const identity of identities) {
      if (await this.passwordService.verifyPassword(dto.password, identity.passwordHash)) {
        passwordBoundIdentity = identity;
        break;
      }
    }
    if (passwordBoundIdentity) throw new ConflictException("该密码已绑定其他昵称，请通过获取昵称继续。");
    const identity = await this.prisma.anonymousTopicIdentity.create({
      data: { topicId, nickname, passwordHash: await this.passwordService.hashPassword(dto.password) },
    }).catch((error) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new ConflictException("该昵称已被使用，请输入密码恢复身份。");
      throw error;
    });
    return { identityToken: await this.signIdentity(topicId, identity.id), nickname: identity.nickname, isCreator: false };
  }

  async createMessage(topicId: number, dto: CreateAnonymousMessageDto) {
    const body = dto.body.trim();
    if (!body) throw new BadRequestException("请输入要发送的内容。");
    this.assertVisitorKey(dto.visitorKey);
    await this.assertRateLimit("message", dto.visitorKey, 1, 6);
    const topic = await this.prisma.anonymousTopic.findFirst({ where: { id: topicId, isHidden: false } });
    if (!topic) throw new NotFoundException("话题不存在或已隐藏。");
    if (topic.status !== AnonymousTopicStatus.active) throw new BadRequestException("该话题已关闭，不能继续发言。");
    const identityId = await this.resolveIdentityToken(topicId, dto.identityToken);
    const message = await this.prisma.$transaction(async (transaction) => {
      // The incremented counter is the public sequence number, so messages do not expose a sender identity.
      const updatedTopic = await transaction.anonymousTopic.update({ where: { id: topicId }, data: { messageCount: { increment: 1 } } });
      return transaction.anonymousTopicMessage.create({
        data: { topicId, sequence: updatedTopic.messageCount, identityId, body },
        include: messageInclude,
      });
    });
    return this.toMessage(message);
  }

  async react(messageId: number, dto: ReactAnonymousMessageDto) {
    this.assertVisitorKey(dto.visitorKey);
    const visitorKey = this.digestVisitorKey(dto.visitorKey);
    const value = dto.value as AnonymousTopicReactionValue;
    const message = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.anonymousTopicMessage.findFirst({
        where: { id: messageId, isHidden: false, topic: { isHidden: false } },
        include: messageInclude,
      });
      if (!current) throw new NotFoundException("消息不存在或已隐藏。");
      const previous = await transaction.anonymousTopicReaction.findUnique({ where: { messageId_visitorKey: { messageId, visitorKey } } });
      const likes = current.likeCount + (previous?.value === AnonymousTopicReactionValue.up ? -1 : 0) + (value === AnonymousTopicReactionValue.up && previous?.value !== value ? 1 : 0);
      const dislikes = current.dislikeCount + (previous?.value === AnonymousTopicReactionValue.down ? -1 : 0) + (value === AnonymousTopicReactionValue.down && previous?.value !== value ? 1 : 0);
      if (previous?.value === value) {
        await transaction.anonymousTopicReaction.delete({ where: { messageId_visitorKey: { messageId, visitorKey } } });
      } else if (previous) {
        await transaction.anonymousTopicReaction.update({ where: { messageId_visitorKey: { messageId, visitorKey } }, data: { value } });
      } else {
        await transaction.anonymousTopicReaction.create({ data: { messageId, visitorKey, value } });
      }
      const updated = await transaction.anonymousTopicMessage.update({
        where: { id: messageId },
        data: { likeCount: Math.max(0, likes), dislikeCount: Math.max(0, dislikes) },
        include: messageInclude,
      });
      const likeDelta = Math.max(0, likes) - current.likeCount;
      if (likeDelta) {
        // List sorting reads the denormalized topic total, so every reaction transition must update it in the same transaction.
        await transaction.anonymousTopic.update({
          where: { id: current.topicId },
          data: { messageLikeCount: { increment: likeDelta } },
        });
      }
      return updated;
    });
    return this.toMessage(message);
  }

  async favorite(id: number, dto: FavoriteAnonymousTopicDto) {
    this.assertVisitorKey(dto.visitorKey);
    const visitorKey = this.digestVisitorKey(dto.visitorKey);
    return this.prisma.$transaction(async (transaction) => {
      const topic = await transaction.anonymousTopic.findFirst({ where: { id, isHidden: false } });
      if (!topic) throw new NotFoundException("话题不存在或已隐藏。");
      const previous = await transaction.anonymousTopicFavorite.findUnique({
        where: { topicId_visitorKey: { topicId: id, visitorKey } },
      });
      if (previous) {
        await transaction.anonymousTopicFavorite.delete({ where: { topicId_visitorKey: { topicId: id, visitorKey } } });
      } else {
        await transaction.anonymousTopicFavorite.create({ data: { topicId: id, visitorKey } });
      }
      const updated = await transaction.anonymousTopic.update({
        where: { id },
        data: { favoriteCount: { increment: previous ? -1 : 1 } },
      });
      return { id, favorited: !previous, favoriteCount: updated.favoriteCount, updatedAt: updated.updatedAt.toISOString() };
    });
  }

  async updateTopic(user: AuthenticatedUser, id: number, dto: UpdateAnonymousTopicDto) {
    this.assertManager(user);
    if (dto.status === undefined && dto.isHidden === undefined) throw new BadRequestException("没有可更新的内容。");
    const topic = await this.prisma.anonymousTopic.update({ where: { id }, data: dto });
    return this.toTopicSummary(topic);
  }

  async updateTopicByCreator(id: number, dto: UpdateAnonymousTopicByCreatorDto) {
    const identityId = await this.resolveIdentityToken(id, dto.identityToken);
    if (!identityId) throw new UnauthorizedException("请先获取话题创建者昵称。");
    const creator = await this.prisma.anonymousTopicIdentity.findFirst({
      where: { id: identityId, topicId: id, isCreator: true },
      select: { id: true },
    });
    if (!creator) throw new ForbiddenException("只有话题创建者可以关闭或重新开放话题。");
    const topic = await this.prisma.anonymousTopic.findFirst({ where: { id, isHidden: false } });
    if (!topic) throw new NotFoundException("话题不存在或已隐藏。");
    const updated = await this.prisma.anonymousTopic.update({ where: { id }, data: { status: dto.status } });
    return this.toTopicSummary(updated);
  }

  async updateMessage(user: AuthenticatedUser, id: number, dto: UpdateAnonymousMessageDto) {
    this.assertManager(user);
    const message = await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.anonymousTopicMessage.findUnique({ where: { id }, include: messageInclude });
      if (!current) throw new NotFoundException("消息不存在。");
      if (current.isHidden === dto.isHidden) return current;
      const updated = await transaction.anonymousTopicMessage.update({ where: { id }, data: { isHidden: dto.isHidden }, include: messageInclude });
      if (current.likeCount) {
        await transaction.anonymousTopic.update({
          where: { id: current.topicId },
          data: { messageLikeCount: { increment: dto.isHidden ? -current.likeCount : current.likeCount } },
        });
      }
      return updated;
    });
    return this.toMessage(message);
  }

  private async resolveIdentityToken(topicId: number, token?: string): Promise<number | null> {
    if (!token?.trim()) return null;
    let payload: IdentityPayload;
    try {
      payload = await this.jwtService.verifyAsync<IdentityPayload>(token, { secret: this.identitySecret() });
    } catch {
      throw new UnauthorizedException("匿名昵称凭据已过期，请重新获取昵称。");
    }
    if (payload.kind !== "anonymous-topic" || payload.topicId !== topicId) throw new UnauthorizedException("匿名昵称凭据无效。");
    const identity = await this.prisma.anonymousTopicIdentity.findFirst({ where: { id: payload.identityId, topicId } });
    if (!identity) throw new UnauthorizedException("匿名昵称不存在，请重新获取昵称。");
    return identity.id;
  }

  private signIdentity(topicId: number, identityId: number): Promise<string> {
    return this.jwtService.signAsync({ topicId, identityId, kind: "anonymous-topic" }, {
      secret: this.identitySecret(),
      expiresIn: "90d" as JwtSignOptions["expiresIn"],
    });
  }

  private topicOrder(sort: ListAnonymousTopicsQueryDto["sort"]): Prisma.AnonymousTopicOrderByWithRelationInput[] {
    if (sort === "participation") return [{ messageCount: "desc" }, { updatedAt: "desc" }, { id: "desc" }];
    if (sort === "likes") return [{ messageLikeCount: "desc" }, { updatedAt: "desc" }, { id: "desc" }];
    if (sort === "favorites") return [{ favoriteCount: "desc" }, { updatedAt: "desc" }, { id: "desc" }];
    if (sort === "home") {
      return [
        { favoriteCount: "desc" },
        { messageCount: "desc" },
        { messageLikeCount: "desc" },
        { updatedAt: "desc" },
        { id: "desc" },
      ];
    }
    return [{ updatedAt: "desc" }, { id: "desc" }];
  }

  private async toTopicSummaries(
    topics: Array<{
      id: number;
      title: string;
      status: AnonymousTopicStatus;
      isHidden: boolean;
      messageCount: number;
      messageLikeCount: number;
      favoriteCount: number;
      createdAt: Date;
      updatedAt: Date;
    }>,
    visitorKey?: string,
  ) {
    const topicIds = topics.map(({ id }) => id);
    if (!topicIds.length) return [];
    const validVisitorKey = visitorKey && visitorKey.trim().length >= 16 && visitorKey.trim().length <= 128
      ? this.digestVisitorKey(visitorKey)
      : null;
    const messageSelect = {
      id: true,
      sequence: true,
      body: true,
      likeCount: true,
      dislikeCount: true,
      identity: { select: { nickname: true } },
    } satisfies Prisma.AnonymousTopicMessageSelect;
    // Two bounded relation queries avoid loading every message body while still returning one highlight of each kind per topic.
    const [likedTopics, dislikedTopics, favoriteRows] = await Promise.all([
      this.prisma.anonymousTopic.findMany({
        where: { id: { in: topicIds } },
        select: {
          id: true,
          messages: {
            where: { isHidden: false, likeCount: { gt: 0 } },
            orderBy: [{ likeCount: "desc" }, { sequence: "asc" }],
            take: 1,
            select: messageSelect,
          },
        },
      }),
      this.prisma.anonymousTopic.findMany({
        where: { id: { in: topicIds } },
        select: {
          id: true,
          messages: {
            where: { isHidden: false, dislikeCount: { gt: 0 } },
            orderBy: [{ dislikeCount: "desc" }, { sequence: "asc" }],
            take: 1,
            select: messageSelect,
          },
        },
      }),
      validVisitorKey
        ? this.prisma.anonymousTopicFavorite.findMany({
          where: { topicId: { in: topicIds }, visitorKey: validVisitorKey },
          select: { topicId: true },
        })
        : Promise.resolve([]),
    ]);
    const likedByTopic = new Map(likedTopics.map((item) => [item.id, item.messages[0]]));
    const dislikedByTopic = new Map(dislikedTopics.map((item) => [item.id, item.messages[0]]));
    const favoriteTopicIds = new Set(favoriteRows.map(({ topicId }) => topicId));
    return topics.map((topic) => this.toTopicSummary(topic, {
      favorited: favoriteTopicIds.has(topic.id),
      topLikedMessage: this.toTopicHighlight(likedByTopic.get(topic.id), "like"),
      topDislikedMessage: this.toTopicHighlight(dislikedByTopic.get(topic.id), "dislike"),
    }));
  }

  private async isTopicFavorited(topicId: number, visitorKey?: string): Promise<boolean> {
    if (!visitorKey || visitorKey.trim().length < 16 || visitorKey.trim().length > 128) return false;
    const favorite = await this.prisma.anonymousTopicFavorite.findUnique({
      where: { topicId_visitorKey: { topicId, visitorKey: this.digestVisitorKey(visitorKey) } },
      select: { topicId: true },
    });
    return Boolean(favorite);
  }

  private toTopicHighlight(
    message: { id: number; sequence: number; body: string; likeCount: number; dislikeCount: number; identity: { nickname: string } | null } | undefined,
    kind: "like" | "dislike",
  ) {
    if (!message) return null;
    return {
      id: message.id,
      sequence: message.sequence,
      body: message.body,
      nickname: message.identity?.nickname ?? null,
      count: kind === "like" ? message.likeCount : message.dislikeCount,
    };
  }

  private toTopicSummary(topic: {
    id: number;
    title: string;
    status: AnonymousTopicStatus;
    isHidden: boolean;
    messageCount: number;
    messageLikeCount: number;
    favoriteCount: number;
    createdAt: Date;
    updatedAt: Date;
  }, context: {
    favorited?: boolean;
    topLikedMessage?: ReturnType<AnonymousTopicsService["toTopicHighlight"]>;
    topDislikedMessage?: ReturnType<AnonymousTopicsService["toTopicHighlight"]>;
  } = {}) {
    return {
      id: topic.id,
      title: topic.title,
      status: topic.status,
      isHidden: topic.isHidden,
      messageCount: topic.messageCount,
      messageLikeCount: topic.messageLikeCount,
      favoriteCount: topic.favoriteCount,
      favorited: context.favorited ?? false,
      topLikedMessage: context.topLikedMessage ?? null,
      topDislikedMessage: context.topDislikedMessage ?? null,
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
    };
  }

  private toMessage(message: MessageRecord) {
    return {
      id: message.id,
      sequence: message.sequence,
      body: message.body,
      nickname: message.identity?.nickname ?? null,
      isHidden: message.isHidden,
      likeCount: message.likeCount,
      dislikeCount: message.dislikeCount,
      createdAt: message.createdAt.toISOString(),
    };
  }

  private assertAnonymousInput(title: string, nickname: string, password: string, visitorKey: string): void {
    if (!title || !nickname) throw new BadRequestException("请填写话题标题和昵称。");
    if (password.length < 6) throw new BadRequestException("密码至少需要 6 位。");
    this.assertVisitorKey(visitorKey);
  }

  private assertVisitorKey(visitorKey: string): void {
    if (visitorKey.trim().length < 16) throw new BadRequestException("匿名访客凭据无效，请刷新页面后重试。");
  }

  private async assertRateLimit(action: string, visitorKey: string, limit: number, seconds: number): Promise<void> {
    const key = `anonymous-topic:${action}:${this.digestVisitorKey(visitorKey)}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, seconds);
    if (count > limit) throw new BadRequestException("操作过于频繁，请稍后再试。");
  }

  private digestVisitorKey(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private identitySecret(): string {
    return process.env.ANONYMOUS_TOPIC_SECRET ?? process.env.JWT_ACCESS_SECRET ?? "dev-anonymous-topic-secret";
  }

  private assertManager(user: AuthenticatedUser): void {
    if (!user.isSuperAdmin && user.role.level < 90) throw new ForbiddenException("仅超级管理员和管理员可以管理匿名话题。");
  }
}
