import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { createHash } from "node:crypto";
import webpush from "web-push";
import { AuthenticatedUser } from "../auth/auth.types";
import { PrismaService } from "../prisma/prisma.service";
import type { ChatMessageResponse } from "../social/social.types";
import { PushSubscriptionDto } from "./dto/push.dto";
import { BrowserPushPayload, PushConfigResponse, PushStatusResponse } from "./push.types";

@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private readonly publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || "";
  private readonly privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || "";
  private readonly subject = process.env.VAPID_SUBJECT?.trim() || "";
  private readonly enabled = Boolean(this.publicKey && this.privateKey && this.subject);
  private pollTimer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    if (!this.enabled) return;
    webpush.setVapidDetails(this.subject, this.publicKey, this.privateKey);
    this.pollTimer = setInterval(() => void this.deliverPendingNotifications(), 12_000);
    this.pollTimer.unref();
    setTimeout(() => void this.deliverPendingNotifications(), 2_000).unref();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  getConfig(): PushConfigResponse {
    return { enabled: this.enabled, publicKey: this.enabled ? this.publicKey : null };
  }

  async getStatus(user: AuthenticatedUser): Promise<PushStatusResponse> {
    return {
      ...this.getConfig(),
      subscriptionCount: await this.prisma.pushSubscription.count({ where: { userId: user.id } }),
    };
  }

  async subscribe(
    user: AuthenticatedUser,
    dto: PushSubscriptionDto,
    userAgent: string,
  ): Promise<PushStatusResponse> {
    this.assertConfigured();
    this.assertEndpoint(dto.endpoint);
    const endpointHash = this.endpointHash(dto.endpoint);
    await this.prisma.pushSubscription.upsert({
      where: { endpointHash },
      create: {
        userId: user.id,
        endpointHash,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: userAgent.slice(0, 500),
      },
      update: {
        userId: user.id,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        userAgent: userAgent.slice(0, 500),
      },
    });
    return this.getStatus(user);
  }

  async unsubscribe(user: AuthenticatedUser, dto: PushSubscriptionDto): Promise<PushStatusResponse> {
    await this.prisma.pushSubscription.deleteMany({
      where: { userId: user.id, endpointHash: this.endpointHash(dto.endpoint) },
    });
    return this.getStatus(user);
  }

  async sendChatMessage(senderId: number, recipientId: number, message: ChatMessageResponse): Promise<void> {
    if (!this.enabled || senderId === recipientId) return;
    const state = await this.prisma.conversationParticipantState.findUnique({
      where: { conversationId_userId: { conversationId: message.conversationId, userId: recipientId } },
      select: { muted: true },
    });
    if (state?.muted) return;
    await this.sendToUser(recipientId, {
      title: message.sender.nickname || message.sender.username,
      body: message.body || (message.attachments.length > 1 ? `发来 ${message.attachments.length} 个附件` : "发来一个附件"),
      url: `/messages?conversation=${message.conversationId}`,
      tag: `chat-${message.conversationId}`,
    });
  }

  private async deliverPendingNotifications(): Promise<void> {
    if (this.polling || !this.enabled) return;
    this.polling = true;
    try {
      const notifications = await this.prisma.userNotification.findMany({
        where: { pushDeliveredAt: null },
        orderBy: [{ id: "asc" }],
        take: 50,
        select: { id: true, userId: true, channel: true, title: true, body: true, actionUrl: true },
      });
      for (const notification of notifications) {
        const state = await this.prisma.userNotificationChannelState.findUnique({
          where: { userId_channel: { userId: notification.userId, channel: notification.channel } },
          select: { pushEnabled: true },
        });
        if (state?.pushEnabled !== false) {
          await this.sendToUser(notification.userId, {
            title: notification.title,
            body: notification.body,
            url: notification.actionUrl || "/",
            tag: `notification-${notification.id}`,
          });
        }
        await this.prisma.userNotification.update({
          where: { id: notification.id },
          data: { pushDeliveredAt: new Date() },
        });
      }
    } catch {
      // The next polling cycle retries records that were not marked as delivered.
    } finally {
      this.polling = false;
    }
  }

  private async sendToUser(userId: number, payload: BrowserPushPayload): Promise<void> {
    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, JSON.stringify({
          ...payload,
          icon: payload.icon || "/icon-192.png",
          badge: payload.badge || "/favicon-48x48.png",
        }), { TTL: 300, urgency: "normal" });
      } catch (error) {
        const statusCode = typeof error === "object" && error && "statusCode" in error
          ? Number((error as { statusCode?: unknown }).statusCode)
          : 0;
        if (statusCode === 404 || statusCode === 410) {
          await this.prisma.pushSubscription.delete({ where: { id: subscription.id } }).catch(() => undefined);
        }
      }
    }));
  }

  private assertConfigured(): void {
    if (!this.enabled) throw new BadRequestException("浏览器推送尚未在服务器上配置。");
  }

  private assertEndpoint(endpoint: string): void {
    try {
      if (new URL(endpoint).protocol !== "https:") throw new Error("Invalid protocol");
    } catch {
      throw new BadRequestException("浏览器推送订阅地址无效。");
    }
  }

  private endpointHash(endpoint: string): string {
    return createHash("sha256").update(endpoint).digest("hex");
  }
}
