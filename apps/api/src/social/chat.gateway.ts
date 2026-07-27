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
import { CallStatus, CallType } from "../generated/prisma/client";
import { RedisService } from "../redis/redis.service";
import { UsersService } from "../users/users.service";
import { CallDescriptor, CallsService } from "./calls.service";
import { SocialService } from "./social.service";

interface ChatSocketData {
  userId?: number;
  messageTimestamps?: number[];
  callTimestamps?: number[];
  authTimer?: NodeJS.Timeout;
  reauthGraceTimer?: NodeJS.Timeout;
}

interface SendMessagePayload {
  conversationId?: unknown;
  body?: unknown;
  attachmentIds?: unknown;
}

interface ReadConversationPayload {
  conversationId?: unknown;
}

interface MessageMutationPayload extends ReadConversationPayload {
  messageIds?: unknown;
}

interface RecallMessagePayload {
  messageId?: unknown;
}

interface ReauthenticatePayload {
  token?: unknown;
}

interface StartCallPayload {
  conversationId?: unknown;
  type?: unknown;
}

interface CallIdPayload {
  callId?: unknown;
}

interface RespondCallPayload extends CallIdPayload {
  accepted?: unknown;
}

interface SignalCallPayload extends CallIdPayload {
  signal?: unknown;
}

interface EndCallPayload extends CallIdPayload {
  reason?: unknown;
}

interface RuntimeCall extends CallDescriptor {
  callerSocketId: string;
  calleeSocketId?: string;
  timer: NodeJS.Timeout;
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
  private readonly runtimeCalls = new Map<number, RuntimeCall>();
  private readonly activeCallByUser = new Map<number, number>();
  private readonly terminatingCalls = new Set<number>();
  private presenceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly socialService: SocialService,
    private readonly callsService: CallsService,
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
      (client.data as ChatSocketData).callTimestamps = [];
      if (payload.exp) this.scheduleReauthentication(client, payload.exp);
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
    if (data.reauthGraceTimer) clearTimeout(data.reauthGraceTimer);
    const userId = data.userId;
    if (!userId) return;
    const sockets = this.socketsByUser.get(userId);
    sockets?.delete(client.id);
    if (!sockets?.size) {
      this.socketsByUser.delete(userId);
      await this.redis.del(this.presenceKey(userId)).catch(() => undefined);
    }
    const activeCall = Array.from(this.runtimeCalls.values()).find((call) =>
      call.callerSocketId === client.id || call.calleeSocketId === client.id,
    );
    if (activeCall) {
      const status = activeCall.status === CallStatus.ringing
        ? activeCall.callerSocketId === client.id ? CallStatus.cancelled : CallStatus.missed
        : CallStatus.failed;
      await this.terminateRuntimeCall(activeCall.id, status, userId, "通话页面已断开").catch(() => undefined);
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
      return { ok: false, error: this.errorMessage(error, "消息发送失败。") };
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
      return { ok: false, error: this.errorMessage(error, "已读状态更新失败。") };
    }
  }

  @SubscribeMessage("chat:conversation:clear")
  async clearConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReadConversationPayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      const conversationId = this.requirePositiveInteger(payload.conversationId, "会话编号无效。");
      const result = await this.socialService.clearConversation(userId, conversationId);
      this.server.to(this.userRoom(userId)).emit("chat:conversation-cleared", { conversationId });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error, "清空聊天失败。") };
    }
  }

  @SubscribeMessage("chat:conversation:delete")
  async deleteConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReadConversationPayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      const conversationId = this.requirePositiveInteger(payload.conversationId, "会话编号无效。");
      const result = await this.socialService.hideConversation(userId, conversationId);
      this.server.to(this.userRoom(userId)).emit("chat:conversation-deleted", { conversationId });
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error, "删除聊天失败。") };
    }
  }

  @SubscribeMessage("chat:messages:delete-self")
  async deleteMessagesForSelf(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MessageMutationPayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      const conversationId = this.requirePositiveInteger(payload.conversationId, "会话编号无效。");
      const messageIds = this.requireMessageIds(payload.messageIds);
      const result = await this.socialService.deleteMessagesForUser(userId, conversationId, messageIds);
      this.server.to(this.userRoom(userId)).emit("chat:messages-deleted", result);
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error, "删除消息失败。") };
    }
  }

  @SubscribeMessage("chat:messages:delete-everyone")
  async deleteMessagesForEveryone(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: MessageMutationPayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      const conversationId = this.requirePositiveInteger(payload.conversationId, "会话编号无效。");
      const messageIds = this.requireMessageIds(payload.messageIds);
      const result = await this.socialService.deleteMessagesForEveryone(userId, conversationId, messageIds);
      for (const participantId of result.participantIds) {
        this.server.to(this.userRoom(participantId)).emit("chat:messages-deleted", {
          conversationId,
          messageIds: result.messageIds,
        });
      }
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error, "双向删除消息失败。") };
    }
  }

  @SubscribeMessage("chat:message:recall")
  async recallMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RecallMessagePayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      const currentUser = await this.usersService.findActiveById(userId);
      const messageId = this.requirePositiveInteger(payload.messageId, "消息编号无效。");
      const result = await this.socialService.recallMessage(currentUser, messageId);
      for (const participantId of result.participantIds) {
        const room = this.server.to(this.userRoom(participantId));
        room.emit("chat:messages-deleted", {
          conversationId: result.conversationId,
          messageIds: [result.messageId],
        });
        room.emit("chat:message", result.replacement);
      }
      return { ok: true, ...result };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error, "撤回消息失败。") };
    }
  }

  @SubscribeMessage("chat:authenticate")
  async reauthenticate(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: ReauthenticatePayload,
  ) {
    try {
      const currentUserId = this.requireUserId(client);
      const token = typeof payload.token === "string" ? payload.token : "";
      const decoded = await this.jwtService.verifyAsync<AccessTokenPayload & { exp?: number }>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-access-token-secret",
      });
      if (decoded.sub !== currentUserId || !decoded.exp) throw new Error("聊天连接重新认证失败。");
      await this.usersService.findActiveById(decoded.sub);
      this.scheduleReauthentication(client, decoded.exp);
      return { ok: true };
    } catch (error) {
      client.disconnect(true);
      return { ok: false, error: this.errorMessage(error, "聊天连接重新认证失败。") };
    }
  }

  @SubscribeMessage("call:start")
  async startCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: StartCallPayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      this.assertCallRate(client);
      if (this.activeCallByUser.has(userId)) throw new Error("当前账号已经有一通电话正在进行。");
      const conversationId = this.requirePositiveInteger(payload.conversationId, "会话编号无效。");
      const type = this.requireCallType(payload.type);
      const call = await this.callsService.startCall(userId, conversationId, type);
      if (this.activeCallByUser.has(call.calleeId)) {
        const response = await this.finishDetachedCall(call, CallStatus.busy, call.calleeId);
        return { ok: false, error: "对方正在通话中。", call: response };
      }
      if (!this.socketsByUser.get(call.calleeId)?.size) {
        const response = await this.finishDetachedCall(call, CallStatus.missed, null);
        return { ok: false, error: "对方当前不在线。", call: response };
      }
      const timer = this.createCallTimer(call.id, CallStatus.missed, null, 45_000, "等待接听超时");
      const runtime: RuntimeCall = { ...call, callerSocketId: client.id, timer };
      this.runtimeCalls.set(call.id, runtime);
      this.activeCallByUser.set(call.callerId, call.id);
      this.activeCallByUser.set(call.calleeId, call.id);
      const [callerView, calleeView] = await Promise.all([
        this.callsService.getCallResponse(call.id, call.callerId),
        this.callsService.getCallResponse(call.id, call.calleeId),
      ]);
      this.server.to(this.userRoom(call.calleeId)).emit("call:incoming", calleeView);
      return { ok: true, call: callerView };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error, "通话发起失败。") };
    }
  }

  @SubscribeMessage("call:respond")
  async respondCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: RespondCallPayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      const callId = this.requirePositiveInteger(payload.callId, "通话编号无效。");
      const runtime = this.requireRuntimeCall(callId);
      if (runtime.calleeId !== userId || runtime.status !== CallStatus.ringing) {
        throw new Error("这通电话已无法处理。");
      }
      if (payload.accepted !== true) {
        await this.terminateRuntimeCall(callId, CallStatus.declined, userId);
        return { ok: true };
      }
      const call = await this.callsService.acceptCall(callId, userId);
      runtime.status = call.status;
      runtime.calleeSocketId = client.id;
      clearTimeout(runtime.timer);
      runtime.timer = this.createCallTimer(callId, CallStatus.failed, null, 45_000, "媒体连接超时");
      const [callerView, calleeView] = await Promise.all([
        this.callsService.getCallResponse(callId, runtime.callerId),
        this.callsService.getCallResponse(callId, runtime.calleeId),
      ]);
      this.server.to(runtime.callerSocketId).emit("call:accepted", callerView);
      this.server.to(this.userRoom(runtime.calleeId)).emit("call:claimed", {
        call: calleeView,
        acceptedBySocketId: client.id,
      });
      return { ok: true, call: calleeView };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error, "通话应答失败。") };
    }
  }

  @SubscribeMessage("call:signal")
  signalCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SignalCallPayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      const callId = this.requirePositiveInteger(payload.callId, "通话编号无效。");
      const runtime = this.requireRuntimeCall(callId);
      if (runtime.status !== CallStatus.accepted && runtime.status !== CallStatus.active) {
        throw new Error("当前通话还不能交换媒体信令。");
      }
      const targetSocketId = this.callTargetSocket(runtime, userId, client.id);
      const signal = this.requireCallSignal(payload.signal);
      this.server.to(targetSocketId).emit("call:signal", { callId, fromUserId: userId, signal });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error, "通话信令发送失败。") };
    }
  }

  @SubscribeMessage("call:connected")
  async callConnected(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CallIdPayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      const callId = this.requirePositiveInteger(payload.callId, "通话编号无效。");
      const runtime = this.requireRuntimeCall(callId);
      this.callTargetSocket(runtime, userId, client.id);
      const call = await this.callsService.markActive(callId, userId);
      runtime.status = call.status;
      clearTimeout(runtime.timer);
      const [callerView, calleeView] = await Promise.all([
        this.callsService.getCallResponse(callId, runtime.callerId),
        this.callsService.getCallResponse(callId, runtime.calleeId),
      ]);
      this.server.to(runtime.callerSocketId).emit("call:active", callerView);
      if (runtime.calleeSocketId) this.server.to(runtime.calleeSocketId).emit("call:active", calleeView);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error, "通话连接状态更新失败。") };
    }
  }

  @SubscribeMessage("call:end")
  async endCall(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: EndCallPayload,
  ) {
    try {
      const userId = this.requireUserId(client);
      const callId = this.requirePositiveInteger(payload.callId, "通话编号无效。");
      const runtime = this.requireRuntimeCall(callId);
      this.callTargetSocket(runtime, userId, client.id, true);
      const status = runtime.status === CallStatus.ringing
        ? userId === runtime.callerId ? CallStatus.cancelled : CallStatus.declined
        : payload.reason === "failed" ? CallStatus.failed : CallStatus.completed;
      await this.terminateRuntimeCall(callId, status, userId, status === CallStatus.failed ? "媒体连接失败" : undefined);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: this.errorMessage(error, "通话结束失败。") };
    }
  }

  onModuleDestroy(): void {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    for (const call of this.runtimeCalls.values()) clearTimeout(call.timer);
  }

  private async refreshPresence(): Promise<void> {
    await Promise.all(
      Array.from(this.socketsByUser.keys()).map((userId) =>
        this.redis.set(this.presenceKey(userId), "online", 90).catch(() => undefined),
      ),
    );
  }

  private scheduleReauthentication(client: Socket, expiresAtSeconds: number): void {
    const data = client.data as ChatSocketData;
    if (data.authTimer) clearTimeout(data.authTimer);
    if (data.reauthGraceTimer) clearTimeout(data.reauthGraceTimer);
    data.reauthGraceTimer = undefined;
    data.authTimer = setTimeout(() => {
      client.emit("chat:reauthenticate");
      data.reauthGraceTimer = setTimeout(() => client.disconnect(true), 30_000);
      data.reauthGraceTimer.unref();
    }, Math.max(1000, expiresAtSeconds * 1000 - Date.now() - 30_000));
    data.authTimer.unref();
  }

  private async finishDetachedCall(
    call: CallDescriptor,
    status: CallStatus,
    endedById: number | null,
  ) {
    const result = await this.callsService.finishCall(call.id, status, endedById);
    if (result.messageId) await this.broadcastCallMessage(result.messageId, call.callerId, call.calleeId);
    return this.callsService.getCallResponse(call.id, call.callerId);
  }

  private async terminateRuntimeCall(
    callId: number,
    status: CallStatus,
    endedById: number | null,
    failureReason?: string,
  ): Promise<void> {
    if (this.terminatingCalls.has(callId)) return;
    const runtime = this.runtimeCalls.get(callId);
    if (!runtime) return;
    this.terminatingCalls.add(callId);
    this.runtimeCalls.delete(callId);
    if (this.activeCallByUser.get(runtime.callerId) === callId) this.activeCallByUser.delete(runtime.callerId);
    if (this.activeCallByUser.get(runtime.calleeId) === callId) this.activeCallByUser.delete(runtime.calleeId);
    clearTimeout(runtime.timer);
    try {
      const result = await this.callsService.finishCall(callId, status, endedById, failureReason);
      const [callerView, calleeView] = await Promise.all([
        this.callsService.getCallResponse(callId, runtime.callerId),
        this.callsService.getCallResponse(callId, runtime.calleeId),
      ]);
      this.server.to(this.userRoom(runtime.callerId)).emit("call:ended", callerView);
      this.server.to(this.userRoom(runtime.calleeId)).emit("call:ended", calleeView);
      if (result.messageId) await this.broadcastCallMessage(result.messageId, runtime.callerId, runtime.calleeId);
    } finally {
      this.terminatingCalls.delete(callId);
    }
  }

  private async broadcastCallMessage(messageId: number, callerId: number, calleeId: number): Promise<void> {
    const message = await this.socialService.getMessageForBroadcast(messageId);
    this.server.to(this.userRoom(callerId)).emit("chat:message", message);
    this.server.to(this.userRoom(calleeId)).emit("chat:message", message);
  }

  private createCallTimer(
    callId: number,
    status: CallStatus,
    endedById: number | null,
    timeout: number,
    reason: string,
  ): NodeJS.Timeout {
    const timer = setTimeout(() => {
      void this.terminateRuntimeCall(callId, status, endedById, reason);
    }, timeout);
    timer.unref();
    return timer;
  }

  private callTargetSocket(
    call: RuntimeCall,
    userId: number,
    socketId: string,
    allowRingingCallee = false,
  ): string {
    if (userId === call.callerId && socketId === call.callerSocketId) {
      if (!call.calleeSocketId && !allowRingingCallee) throw new Error("对方尚未接听。");
      return call.calleeSocketId ?? "";
    }
    if (userId === call.calleeId && (socketId === call.calleeSocketId || (allowRingingCallee && !call.calleeSocketId))) {
      return call.callerSocketId;
    }
    throw new Error("这通电话正在其他页面中进行。");
  }

  private requireRuntimeCall(callId: number): RuntimeCall {
    const call = this.runtimeCalls.get(callId);
    if (!call) throw new Error("通话已结束或不存在。");
    return call;
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

  private requireCallType(value: unknown): CallType {
    if (value === CallType.voice || value === CallType.video) return value;
    throw new Error("通话类型无效。");
  }

  private requireCallSignal(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object") throw new Error("通话信令无效。");
    const signal = value as Record<string, unknown>;
    if (!["offer", "answer", "ice-candidate"].includes(String(signal.type))) {
      throw new Error("通话信令类型无效。");
    }
    const serialized = JSON.stringify(signal);
    if (serialized.length > 12_000) throw new Error("通话信令过大。");
    if ((signal.type === "offer" || signal.type === "answer") && typeof signal.sdp !== "string") {
      throw new Error("会话描述无效。");
    }
    if (signal.type === "ice-candidate" && signal.candidate !== null && typeof signal.candidate !== "object") {
      throw new Error("网络候选地址无效。");
    }
    return signal;
  }

  private assertMessageRate(client: Socket): void {
    const data = client.data as ChatSocketData;
    const now = Date.now();
    const timestamps = (data.messageTimestamps ?? []).filter((timestamp) => now - timestamp < 10_000);
    if (timestamps.length >= 12) throw new Error("消息发送过于频繁，请稍后再试。");
    timestamps.push(now);
    data.messageTimestamps = timestamps;
  }

  private assertCallRate(client: Socket): void {
    const data = client.data as ChatSocketData;
    const now = Date.now();
    const timestamps = (data.callTimestamps ?? []).filter((timestamp) => now - timestamp < 60_000);
    if (timestamps.length >= 5) throw new Error("通话发起过于频繁，请稍后再试。");
    timestamps.push(now);
    data.callTimestamps = timestamps;
  }

  private requireAttachmentIds(value: unknown): number[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || value.length > 9) {
      throw new Error("单条消息最多包含 9 个附件。");
    }
    return value.map((item) => this.requirePositiveInteger(item, "附件编号无效。"));
  }

  private requireMessageIds(value: unknown): number[] {
    if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
      throw new Error("请选择 1 至 100 条消息。");
    }
    const messageIds = value.map((item) => this.requirePositiveInteger(item, "消息编号无效。"));
    if (new Set(messageIds).size !== messageIds.length) {
      throw new Error("消息编号不能重复。");
    }
    return messageIds;
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

  private errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message ? error.message : fallback;
  }
}
