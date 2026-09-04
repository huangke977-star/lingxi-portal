import { BadRequestException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, UnauthorizedException } from "@nestjs/common";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { ExternalNotificationChannel, Prisma, WebhookDeliveryStatus } from "../generated/prisma/client";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { SecretCryptoService } from "../security/secret-crypto.service";
import { CreateExternalChannelDto, CreateReadOnlyTokenDto, CreateWebhookDto, ReadOnlyScope, UpdateExternalChannelDto, UpdateWebhookDto } from "./dto/integrations.dto";

const MAX_WEBHOOK_ATTEMPTS = 5;
const WEBHOOK_EVENTS = new Set(["integration.test", "user.registered", "article.published", "article.commented", "notification.created", "resource.redeemed"]);

@Injectable()
export class IntegrationsService implements OnModuleInit, OnModuleDestroy {
  private deliveryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly crypto: SecretCryptoService,
  ) {}

  onModuleInit(): void {
    this.deliveryTimer = setInterval(() => void this.processDueDeliveries(), 30_000);
    this.deliveryTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
  }

  async listWebhooks() {
    const items = await this.prisma.externalWebhookEndpoint.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { deliveries: true } } } });
    return items.map((item) => ({ id: item.id, name: item.name, url: item.url, events: this.asStringArray(item.events), enabled: item.enabled, deliveryCount: item._count.deliveries, lastDeliveredAt: item.lastDeliveredAt?.toISOString() ?? null, lastError: item.lastError, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }));
  }

  async createWebhook(actor: AuthenticatedUser, dto: CreateWebhookDto) {
    const events = this.normalizeEvents(dto.events);
    const item = await this.prisma.externalWebhookEndpoint.create({ data: { ownerId: actor.id, name: dto.name.trim(), url: dto.url, secretEncrypted: this.crypto.encrypt(dto.secret), events } });
    return { id: item.id, name: item.name, url: item.url, events, enabled: item.enabled, secretConfigured: true, createdAt: item.createdAt.toISOString() };
  }

  async updateWebhook(id: number, dto: UpdateWebhookDto) {
    const existing = await this.prisma.externalWebhookEndpoint.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException("Webhook 不存在。\nWebhook endpoint not found.");
    const item = await this.prisma.externalWebhookEndpoint.update({ where: { id }, data: { ...(dto.name === undefined ? {} : { name: dto.name.trim() }), ...(dto.url === undefined ? {} : { url: dto.url }), ...(dto.events === undefined ? {} : { events: this.normalizeEvents(dto.events) }), ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }), ...(dto.secret === undefined ? {} : { secretEncrypted: this.crypto.encrypt(dto.secret) }) } });
    return { id: item.id, name: item.name, url: item.url, events: this.asStringArray(item.events), enabled: item.enabled, secretConfigured: true, updatedAt: item.updatedAt.toISOString() };
  }

  async deleteWebhook(id: number) {
    await this.prisma.externalWebhookEndpoint.delete({ where: { id } }).catch(() => { throw new NotFoundException("Webhook 不存在。\nWebhook endpoint not found."); });
    return { success: true as const };
  }

  async listDeliveries(endpointId?: number) {
    const rows = await this.prisma.externalWebhookDelivery.findMany({ where: endpointId ? { endpointId } : undefined, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, endpointId: true, eventId: true, eventType: true, status: true, attempts: true, nextAttemptAt: true, deliveredAt: true, lastError: true, createdAt: true } });
    return rows.map((row) => ({ ...row, status: row.status as string, nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null, deliveredAt: row.deliveredAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }));
  }

  async replayDelivery(id: number) {
    const delivery = await this.prisma.externalWebhookDelivery.findUnique({ where: { id }, select: { id: true } });
    if (!delivery) throw new NotFoundException("投递记录不存在。\nDelivery not found.");
    await this.prisma.externalWebhookDelivery.update({ where: { id }, data: { status: WebhookDeliveryStatus.pending, nextAttemptAt: new Date(), lastError: null } });
    await this.deliverOne(id);
    return { success: true as const };
  }

  async emit(eventType: string, data: Record<string, unknown>, eventId = randomBytes(16).toString("hex")): Promise<void> {
    if (!WEBHOOK_EVENTS.has(eventType)) throw new BadRequestException("不支持的 Webhook 事件。\nUnsupported webhook event.");
    const endpoints = await this.prisma.externalWebhookEndpoint.findMany({ where: { enabled: true } });
    const payload = { id: eventId, type: eventType, createdAt: new Date().toISOString(), data: this.redact(data) };
    for (const endpoint of endpoints) {
      if (!this.asStringArray(endpoint.events).includes(eventType)) continue;
      try {
        const delivery = await this.prisma.externalWebhookDelivery.create({ data: { endpointId: endpoint.id, eventId, eventType, idempotencyKey: `${eventType}:${eventId}`, payload } });
        void this.deliverOne(delivery.id);
      } catch (error) {
        if (!this.isUnique(error)) throw error;
      }
    }
  }

  async createToken(user: AuthenticatedUser, dto: CreateReadOnlyTokenDto) {
    const scopes = [...new Set(dto.scopes)] as ReadOnlyScope[];
    if (!scopes.length) throw new BadRequestException("至少选择一个只读权限。\nChoose at least one read-only scope.");
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now())) throw new BadRequestException("过期时间必须晚于当前时间。\nExpiry must be in the future.");
    const raw = `lvt_${randomBytes(32).toString("base64url")}`;
    const item = await this.prisma.readOnlyApiToken.create({ data: { userId: user.id, name: dto.name.trim(), tokenPrefix: raw.slice(0, 16), tokenHash: this.hash(raw), scopes, expiresAt } });
    return { id: item.id, name: item.name, token: raw, tokenPrefix: item.tokenPrefix, scopes, expiresAt: item.expiresAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString() };
  }

  async listTokens(user: AuthenticatedUser) {
    const rows = await this.prisma.readOnlyApiToken.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    return rows.map((row) => ({ id: row.id, name: row.name, tokenPrefix: row.tokenPrefix, scopes: this.asStringArray(row.scopes), expiresAt: row.expiresAt?.toISOString() ?? null, lastUsedAt: row.lastUsedAt?.toISOString() ?? null, revokedAt: row.revokedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }));
  }

  async revokeToken(user: AuthenticatedUser, id: number) {
    const result = await this.prisma.readOnlyApiToken.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!result.count) throw new NotFoundException("令牌不存在或已经撤销。\nToken not found or already revoked.");
    return { success: true as const };
  }

  async authenticateReadOnlyToken(rawHeader: string | undefined, requiredScope: ReadOnlyScope) {
    const raw = rawHeader?.startsWith("Bearer ") ? rawHeader.slice(7).trim() : "";
    if (!raw.startsWith("lvt_")) throw new UnauthorizedException("只读 API 令牌无效。\nInvalid read-only API token.");
    const item = await this.prisma.readOnlyApiToken.findUnique({ where: { tokenHash: this.hash(raw), }, include: { user: { select: { id: true, username: true, nickname: true, email: true, status: true } } } });
    if (!item || item.revokedAt || (item.expiresAt && item.expiresAt <= new Date()) || item.user.status !== "active") throw new UnauthorizedException("只读 API 令牌无效或已过期。\nRead-only API token is invalid or expired.");
    const scopes = this.asStringArray(item.scopes);
    if (!scopes.includes(requiredScope)) throw new UnauthorizedException("令牌没有所需权限。\nToken scope is insufficient.");
    const rateKey = `readonly_api_rate:${item.id}:${Math.floor(Date.now() / 60_000)}`;
    const count = await this.redis.incr(rateKey);
    if (count === 1) await this.redis.expire(rateKey, 70);
    if (count > 120) throw new UnauthorizedException("只读 API 请求过于频繁。\nRead-only API rate limit exceeded.");
    await this.prisma.readOnlyApiToken.update({ where: { id: item.id }, data: { lastUsedAt: new Date() } });
    return item;
  }

  async listReadOnlyArticles(rawHeader: string | undefined, search?: string, limit = 20) {
    await this.authenticateReadOnlyToken(rawHeader, "read_articles");
    const rows = await this.prisma.article.findMany({ where: { status: "published", ...(search?.trim() ? { OR: [{ title: { contains: search.trim() } }, { summary: { contains: search.trim() } }] } : {}) }, orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: Math.min(50, Math.max(1, limit)), select: { id: true, slug: true, title: true, summary: true, category: true, publishedAt: true, author: { select: { username: true, nickname: true } } } });
    return { items: rows.map((row) => ({ ...row, publishedAt: row.publishedAt?.toISOString() ?? null })), count: rows.length };
  }

  async getReadOnlyProfile(rawHeader: string | undefined, username: string) {
    await this.authenticateReadOnlyToken(rawHeader, "read_profile");
    const user = await this.prisma.user.findUnique({ where: { username }, select: { id: true, username: true, nickname: true, profileBio: true, avatarStoredName: true, role: { select: { code: true, name: true, level: true } } } });
    if (!user) throw new NotFoundException("用户不存在。\nUser not found.");
    return { id: user.id, username: user.username, nickname: user.nickname, profileBio: user.profileBio, avatarUrl: user.avatarStoredName ? `/auth/avatars/${user.avatarStoredName}` : null, role: user.role };
  }

  async listReadOnlyNotifications(rawHeader: string | undefined, limit = 20) {
    const token = await this.authenticateReadOnlyToken(rawHeader, "read_notifications");
    const rows = await this.prisma.userNotification.findMany({
      where: { userId: token.userId },
      orderBy: [{ id: "desc" }],
      take: Math.min(50, Math.max(1, limit)),
      select: { id: true, type: true, channel: true, title: true, body: true, bodyEn: true, actionUrl: true, aggregateCount: true, readAt: true, openedAt: true, createdAt: true },
    });
    return {
      items: rows.map((row) => ({ ...row, type: row.type as string, channel: row.channel as string, readAt: row.readAt?.toISOString() ?? null, openedAt: row.openedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })),
      count: rows.length,
    };
  }

  async listChannels(user: AuthenticatedUser) {
    const rows = await this.prisma.externalNotificationChannel.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
    return rows.map((row) => this.channelResponse(row));
  }

  async createChannel(user: AuthenticatedUser, dto: CreateExternalChannelDto) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const row = await this.prisma.externalNotificationChannel.create({ data: { userId: user.id, kind: dto.kind, endpoint: dto.endpoint, secretEncrypted: dto.secret?.trim() ? this.crypto.encrypt(dto.secret) : null, preferences: dto.preferences ?? { interaction: true, subscription: true, system: false }, verificationCodeHash: this.hash(`${dto.endpoint}:${code}`), verificationExpiresAt: expiresAt } });
    try { await this.sendExternal(row, { type: "verification", code, expiresAt: expiresAt.toISOString() }); } catch (error) { await this.prisma.externalNotificationChannel.delete({ where: { id: row.id } }); throw new BadRequestException(`外部通知通道验证消息发送失败：${this.errorMessage(error)}`); }
    return { ...this.channelResponse(row), verificationExpiresAt: expiresAt.toISOString(), verificationRequired: true };
  }

  async verifyChannel(user: AuthenticatedUser, id: number, code: string) {
    const row = await this.prisma.externalNotificationChannel.findFirst({ where: { id, userId: user.id } });
    if (!row || !row.verificationCodeHash || !row.verificationExpiresAt || row.verificationExpiresAt <= new Date()) throw new BadRequestException("验证请求已失效，请重新添加通道。\nVerification request expired.");
    const expected = Buffer.from(row.verificationCodeHash, "hex"); const actual = Buffer.from(this.hash(`${row.endpoint}:${code}`), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new BadRequestException("验证码不正确。\nVerification code is incorrect.");
    const updated = await this.prisma.externalNotificationChannel.update({ where: { id }, data: { enabled: true, verifiedAt: new Date(), verificationCodeHash: null, verificationExpiresAt: null } });
    return this.channelResponse(updated);
  }

  async updateChannel(user: AuthenticatedUser, id: number, dto: UpdateExternalChannelDto) {
    const row = await this.prisma.externalNotificationChannel.updateMany({ where: { id, userId: user.id, verifiedAt: { not: null } }, data: { ...(dto.enabled === undefined ? {} : { enabled: dto.enabled }), ...(dto.preferences === undefined ? {} : { preferences: dto.preferences }) } });
    if (!row.count) throw new NotFoundException("外部通知通道不存在。\nExternal channel not found.");
    return this.channelResponse((await this.prisma.externalNotificationChannel.findUniqueOrThrow({ where: { id } })));
  }

  async deleteChannel(user: AuthenticatedUser, id: number) { const row = await this.prisma.externalNotificationChannel.deleteMany({ where: { id, userId: user.id } }); if (!row.count) throw new NotFoundException("外部通知通道不存在。\nExternal channel not found."); return { success: true as const }; }

  async deliverExternalNotification(userId: number, type: string, data: Record<string, unknown>) {
    const rows = await this.prisma.externalNotificationChannel.findMany({ where: { userId, enabled: true, verifiedAt: { not: null } } });
    await Promise.all(rows.filter((row) => this.channelEnabledFor(row, type)).map(async (row) => { try { await this.sendExternal(row, { type, data: this.redact(data), createdAt: new Date().toISOString() }); await this.prisma.externalNotificationChannel.update({ where: { id: row.id }, data: { failureCount: 0, lastError: null, lastDeliveredAt: new Date() } }); } catch (error) { await this.prisma.externalNotificationChannel.update({ where: { id: row.id }, data: { failureCount: { increment: 1 }, lastError: this.errorMessage(error).slice(0, 1000) } }); } }));
  }

  private async processDueDeliveries() { const rows = await this.prisma.externalWebhookDelivery.findMany({ where: { status: WebhookDeliveryStatus.pending, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }, orderBy: { id: "asc" }, take: 20, select: { id: true } }); await Promise.all(rows.map((row) => this.deliverOne(row.id))); }
  private async deliverOne(id: number) {
    const delivery = await this.prisma.externalWebhookDelivery.findUnique({ where: { id }, include: { endpoint: true } }); if (!delivery || !delivery.endpoint.enabled || delivery.status === WebhookDeliveryStatus.delivered) return;
    const body = JSON.stringify(delivery.payload); const attempt = delivery.attempts + 1;
    try { const secret = this.crypto.decrypt(delivery.endpoint.secretEncrypted); const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`; const response = await fetch(delivery.endpoint.url, { method: "POST", headers: { "content-type": "application/json", "user-agent": "Lingxi-Webhook/1.0", "x-lingxi-event": delivery.eventType, "x-lingxi-event-id": delivery.eventId, "idempotency-key": delivery.idempotencyKey, "x-lingxi-signature-256": signature }, body, signal: AbortSignal.timeout(8_000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); await this.prisma.externalWebhookDelivery.update({ where: { id }, data: { status: WebhookDeliveryStatus.delivered, attempts: attempt, deliveredAt: new Date(), lastError: null } }); await this.prisma.externalWebhookEndpoint.update({ where: { id: delivery.endpointId }, data: { lastDeliveredAt: new Date(), lastError: null } }); }
    catch (error) { const final = attempt >= MAX_WEBHOOK_ATTEMPTS; const delay = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1)); const message = this.errorMessage(error).slice(0, 1000); await this.prisma.externalWebhookDelivery.update({ where: { id }, data: { status: final ? WebhookDeliveryStatus.failed : WebhookDeliveryStatus.pending, attempts: attempt, nextAttemptAt: final ? null : new Date(Date.now() + delay * 1000), lastError: message } }); await this.prisma.externalWebhookEndpoint.update({ where: { id: delivery.endpointId }, data: { lastError: message } }); }
  }

  private async sendExternal(row: Pick<ExternalNotificationChannel, "endpoint" | "secretEncrypted">, payload: Record<string, unknown>) { const body = JSON.stringify(payload); const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "Lingxi-Notifications/1.0" }; if (row.secretEncrypted) headers["x-lingxi-signature-256"] = `sha256=${createHmac("sha256", this.crypto.decrypt(row.secretEncrypted)).update(body).digest("hex")}`; const response = await fetch(row.endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(8_000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); }
  private channelEnabledFor(row: ExternalNotificationChannel, type: string) { const preferences = row.preferences && typeof row.preferences === "object" ? row.preferences as Record<string, unknown> : {}; return preferences[type] !== false; }
  private channelResponse(row: ExternalNotificationChannel) { return { id: row.id, kind: row.kind, endpoint: row.endpoint, preferences: row.preferences, enabled: row.enabled, verified: Boolean(row.verifiedAt), failureCount: row.failureCount, lastError: row.lastError, lastDeliveredAt: row.lastDeliveredAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() }; }
  private normalizeEvents(events: string[]) { const normalized = [...new Set(events.map((event) => event.trim()).filter((event) => WEBHOOK_EVENTS.has(event)))]; if (!normalized.length) throw new BadRequestException("没有可用的 Webhook 事件。\nNo supported webhook event was selected."); return normalized; }
  private asStringArray(value: Prisma.JsonValue): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
  private redact(value: unknown, depth = 0): Prisma.InputJsonValue { if (depth > 4) return "[TRUNCATED]"; if (value === null || value === undefined) return "[REDACTED]"; if (typeof value === "string") return /(password|secret|token|authorization|cookie|code|private)/i.test(value) ? "[REDACTED]" : value.slice(0, 1000); if (typeof value === "number" || typeof value === "boolean") return value; if (Array.isArray(value)) return value.slice(0, 50).map((item) => this.redact(item, depth + 1)); if (typeof value === "object") { const result: Record<string, Prisma.InputJsonValue> = {}; for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) result[key] = /(password|secret|token|authorization|cookie|private|credential)/i.test(key) ? "[REDACTED]" : this.redact(item, depth + 1); return result; } return String(value); }
  private hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
  private isUnique(error: unknown) { return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002"; }
  private errorMessage(error: unknown) { return error instanceof Error && error.message ? error.message : "未知错误"; }
}
