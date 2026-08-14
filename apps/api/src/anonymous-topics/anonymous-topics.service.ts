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
  GetAnonymousTopicQueryDto,
  ListAnonymousTopicsQueryDto,
  ReactAnonymousMessageDto,
  UpdateAnonymousMessageDto,
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

  async list(query: ListAnonymousTopicsQueryDto) {
    const where = { isHidden: false };
    const [total, items] = await Promise.all([
      this.prisma.anonymousTopic.count({ where }),
      this.prisma.anonymousTopic.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
    ]);
    return {
      items: items.map((topic) => this.toTopicSummary(topic)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    };
  }

  async get(id: number, query: GetAnonymousTopicQueryDto) {
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
    return { ...this.toTopicSummary(topic), identityToken: await this.signIdentity(topic.id, identity.id), nickname: identity.nickname };
  }

  async claimIdentity(topicId: number, dto: ClaimAnonymousIdentityDto) {
    const topic = await this.prisma.anonymousTopic.findFirst({ where: { id: topicId, isHidden: false } });
    if (!topic) throw new NotFoundException("话题不存在或已隐藏。");
    const nickname = dto.nickname.trim();
    this.assertAnonymousInput("话题", nickname, dto.password, dto.visitorKey);
    await this.assertRateLimit("identity", dto.visitorKey, 10, 10 * 60);
    const existing = await this.prisma.anonymousTopicIdentity.findUnique({ where: { topicId_nickname: { topicId, nickname } } });
    if (existing) {
      if (!await this.passwordService.verifyPassword(dto.password, existing.passwordHash)) {
        throw new UnauthorizedException("昵称或密码不正确。");
      }
      return { identityToken: await this.signIdentity(topicId, existing.id), nickname: existing.nickname, isCreator: existing.isCreator };
    }
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
      return transaction.anonymousTopicMessage.update({
        where: { id: messageId },
        data: { likeCount: Math.max(0, likes), dislikeCount: Math.max(0, dislikes) },
        include: messageInclude,
      });
    });
    return this.toMessage(message);
  }

  async updateTopic(user: AuthenticatedUser, id: number, dto: UpdateAnonymousTopicDto) {
    this.assertSuperAdmin(user);
    if (dto.status === undefined && dto.isHidden === undefined) throw new BadRequestException("没有可更新的内容。");
    const topic = await this.prisma.anonymousTopic.update({ where: { id }, data: dto });
    return this.toTopicSummary(topic);
  }

  async updateMessage(user: AuthenticatedUser, id: number, dto: UpdateAnonymousMessageDto) {
    this.assertSuperAdmin(user);
    const message = await this.prisma.anonymousTopicMessage.update({ where: { id }, data: { isHidden: dto.isHidden }, include: messageInclude });
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

  private toTopicSummary(topic: { id: number; title: string; status: AnonymousTopicStatus; isHidden: boolean; messageCount: number; createdAt: Date; updatedAt: Date }) {
    return {
      id: topic.id,
      title: topic.title,
      status: topic.status,
      messageCount: topic.messageCount,
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

  private assertSuperAdmin(user: AuthenticatedUser): void {
    if (!user.isSuperAdmin) throw new ForbiddenException("仅超级管理员可以管理匿名话题。");
  }
}
