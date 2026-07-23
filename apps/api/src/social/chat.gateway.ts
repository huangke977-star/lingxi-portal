import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from "@nestjs/websockets";
import type { Server, Socket } from "socket.io";
import { AccessTokenPayload } from "../auth/auth.types";
import { RedisService } from "../redis/redis.service";
import { UsersService } from "../users/users.service";
import { SocialService } from "./social.service";

interface ChatSocketData {
  userId?: number;
  messageTimestamps?: number[];
  authTimer?: NodeJS.Timeout;
}

interface SendMessagePayload {
  conversationId?: unknown;
  body?: unknown;
  attachmentIds?: unknown;
}

interface ReadConversationPayload {
  conversationId?: unknown;
}

@Injectable()
@WebSocketGateway({
  namespace: "/chat",
  path: "/socket.io",
  transports: ["websocket"],
  cors: { origin: true, credentials: true },
  maxHttpBufferSize: 16 * 1024,
  pingInterval: 25_000,
  pingTimeout: 20_000,
})
export class ChatGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  @WebSocketServer()
  private server!: Server;

  private readonly socketsByUser = new Map<number, Set<string>>();
  private presenceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly socialService: SocialService,
    private readonly redis: RedisService,
  ) {}

  afterInit(): void {
    this.presenceTimer = setInterval(() => void this.refreshPresence(), 60_000);
    this.presenceTimer.unref();
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      if (!this.isAllowedOrigin(client.handshake.headers.origin)) {
        client.emit("chat:error", { message: "当前页面来源不允许建立聊天连接。" });
        client.disconnect(true);
        return;
      }
      const token = typeof client.handshake.auth?.token === "string" ? client.handshake.auth.token : "";
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload & { exp?: number }>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-access-token-secret",
      });
      const user = await this.usersService.findActiveById(payload.sub);
      const existingSockets = this.socketsByUser.get(user.id) ?? new Set<string>();
      if (existingSockets.size >= 3) {
        client.emit("chat:error", { message: "当前账号打开的聊天页面过多。" });
        client.disconnect(true);
        return;
      }
      existingSockets.add(client.id);
      this.socketsByUser.set(user.id, existingSockets);
      (client.data as ChatSocketData).userId = user.id;
      (client.data as ChatSocketData).messageTimestamps = [];
      if (payload.exp) {
        (client.data as ChatSocketData).authTimer = setTimeout(() => {
          client.emit("chat:reauthenticate");
          client.disconnect(true);
        }, Math.max(1000, payload.exp * 1000 - Date.now()));
        (client.data as ChatSocketData).authTimer?.unref();
      }
      await client.join(this.userRoom(user.id));
      await this.redis.set(this.presenceKey(user.id), "online", 90);
      client.emit("chat:ready", { userId: user.id });
    } catch {
      client.emit("chat:error", { message: "聊天连接认证失败，请重新登录。" });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const data = client.data as ChatSocketData;
    if (data.authTimer) clearTimeout(data.authTimer);
    const userId = data.userId;
    if (!userId) return;
    const sockets = this.socketsByUser.get(userId);
    sockets?.delete(client.id);
    if (!sockets?.size) {
      this.socketsByUser.delete(userId);
      await this.redis.del(this.presenceKey(userId)).catch(() => undefined);
    }
  }

  @SubscribeMessage("chat:send")
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessagePayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      this.assertMessageRate(client);
      const conversationId = this.requirePositiveInteger(payload.conversationId, "会话编号无效。");
      const body = typeof payload.body === "string" ? payload.body : "";
      const attachmentIds = this.requireAttachmentIds(payload.attachmentIds);
      const message = await this.socialService.createMessage(userId, conversationId, body, attachmentIds);
      const participantIds = await this.socialService.getConversationParticipantIds(conversationId);
      for (const participantId of participantIds) {
        this.server.to(this.userRoom(participantId)).emit("chat:message", message);
      }
      return { ok: true, message };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "消息发送失败。" };
    }
  }

  @SubscribeMessage("chat:read")
  async readConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReadConversationPayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      const conversationId = this.requirePositiveInteger(payload.conversationId, "会话编号无效。");
      const result = await this.socialService.markConversationRead(userId, conversationId);
      for (const participantId of result.participantIds) {
        this.server.to(this.userRoom(participantId)).emit("chat:read", {
          conversationId,
          readerId: userId,
          readAt: result.readAt,
        });
      }
      return { ok: true, count: result.count, readAt: result.readAt };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "已读状态更新失败。" };
    }
  }

  onModuleDestroy(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
  }

  private async refreshPresence(): Promise<void> {
    await Promise.all(
      Array.from(this.socketsByUser.keys()).map((userId) =>
        this.redis.set(this.presenceKey(userId), "online", 90).catch(() => undefined),
      ),
    );
  }

  private requireUserId(client: Socket): number {
    const userId = (client.data as ChatSocketData).userId;
    if (!userId) throw new Error("聊天连接未认证。");
    return userId;
  }

  private requirePositiveInteger(value: unknown, message: string): number {
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(number) || number < 1) throw new Error(message);
    return number;
  }

  private assertMessageRate(client: Socket): void {
    const data = client.data as ChatSocketData;
    const now = Date.now();
    const timestamps = (data.messageTimestamps ?? []).filter((timestamp) => now - timestamp < 10_000);
    if (timestamps.length >= 12) throw new Error("消息发送过于频繁，请稍后再试。");
    timestamps.push(now);
    data.messageTimestamps = timestamps;
  }

  private requireAttachmentIds(value: unknown): number[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 9) {
      throw new Error("单条消息最多包含 9 个附件。");
    }
    return value.map((item) => this.requirePositiveInteger(item, "附件编号无效。"));
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    const configured = new Set(
      (process.env.WEB_ORIGIN ?? "http://localhost:3000")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    configured.add("http://localhost:3000");
    configured.add("http://127.0.0.1:3000");
    const domain = process.env.SITE_DOMAIN?.trim();
    if (domain) {
      configured.add(`https://${domain}`);
      configured.add(`http://${domain}`);
    }
    return configured.has(origin);
  }

  private userRoom(userId: number): string {
    return `user:${userId}`;
  }

  private presenceKey(userId: number): string {
    return `chat:presence:${userId}`;
  }
}
