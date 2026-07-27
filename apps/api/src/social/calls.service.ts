import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { createHmac } from "node:crypto";
import {
  CallStatus,
  CallType,
  ChatMessageType,
  FriendshipStatus,
  Prisma,
} from "../generated/prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CallSessionResponse, IceServerConfigResponse } from "./social.types";

const callUserSelect = {
  id: true,
  nickname: true,
  username: true,
  avatarStoredName: true,
  profileBio: true,
  isSuperAdmin: true,
  createdAt: true,
  status: true,
  role: { select: { code: true, name: true, level: true } },
} satisfies Prisma.UserSelect;

const callInclude = {
  caller: { select: callUserSelect },
  callee: { select: callUserSelect },
} satisfies Prisma.CallSessionInclude;

const OPEN_CALL_STATUSES = [CallStatus.ringing, CallStatus.accepted, CallStatus.active] as const;
const TERMINAL_CALL_STATUSES = new Set<CallStatus>([
  CallStatus.declined,
  CallStatus.busy,
  CallStatus.cancelled,
  CallStatus.missed,
  CallStatus.completed,
  CallStatus.failed,
]);

export interface CallDescriptor {
  id: number;
  conversationId: number;
  callerId: number;
  calleeId: number;
  type: CallType;
  status: CallStatus;
}

@Injectable()
export class CallsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.prisma.callSession?.updateMany({
      where: { status: { in: [...OPEN_CALL_STATUSES] } },
      data: {
        status: CallStatus.failed,
        endedAt: new Date(),
        failureReason: "服务重启导致通话中断",
      },
    });
  }

  async startCall(userId: number, conversationId: number, type: CallType): Promise<CallDescriptor> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        friendship: {
          select: { userOneId: true, userTwoId: true, status: true },
        },
      },
    });
    if (
      !conversation ||
      conversation.friendship.status !== FriendshipStatus.accepted ||
      ![conversation.friendship.userOneId, conversation.friendship.userTwoId].includes(userId)
    ) {
      throw new ForbiddenException("只有当前好友会话可以发起通话。");
    }
    const activeCall = await this.prisma.callSession.findFirst({
      where: {
        status: { in: [...OPEN_CALL_STATUSES] },
        OR: [{ callerId: userId }, { calleeId: userId }],
      },
      select: { id: true },
    });
    if (activeCall) throw new BadRequestException("当前账号已经有一通电话正在进行。");
    const calleeId = conversation.friendship.userOneId === userId
      ? conversation.friendship.userTwoId
      : conversation.friendship.userOneId;
    const call = await this.prisma.callSession.create({
      data: { conversationId, callerId: userId, calleeId, type },
    });
    return this.toDescriptor(call);
  }

  async acceptCall(callId: number, calleeId: number): Promise<CallDescriptor> {
    const acceptedAt = new Date();
    const result = await this.prisma.callSession.updateMany({
      where: { id: callId, calleeId, status: CallStatus.ringing },
      data: { status: CallStatus.accepted, acceptedAt },
    });
    if (result.count !== 1) throw new BadRequestException("这通电话已无法接听。");
    return this.getDescriptor(callId);
  }

  async markActive(callId: number, userId: number): Promise<CallDescriptor> {
    await this.assertParticipant(callId, userId);
    await this.prisma.callSession.updateMany({
      where: { id: callId, status: CallStatus.accepted },
      data: { status: CallStatus.active },
    });
    return this.getDescriptor(callId);
  }

  async finishCall(
    callId: number,
    status: CallStatus,
    endedById: number | null,
    failureReason?: string,
  ): Promise<{ call: CallDescriptor; messageId: number | null }> {
    if (!TERMINAL_CALL_STATUSES.has(status)) {
      throw new BadRequestException("通话结束状态无效。");
    }
    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.callSession.findUnique({ where: { id: callId }, include: callInclude });
      if (!existing) throw new NotFoundException("通话记录不存在。");
      if (endedById && ![existing.callerId, existing.calleeId].includes(endedById)) {
        throw new ForbiddenException("没有操作这通电话的权限。");
      }
      if (TERMINAL_CALL_STATUSES.has(existing.status)) {
        return { call: this.toDescriptor(existing), messageId: null };
      }
      const endedAt = new Date();
      const durationSeconds = existing.acceptedAt
        ? Math.max(0, Math.floor((endedAt.getTime() - existing.acceptedAt.getTime()) / 1000))
        : null;
      const updatedCount = await transaction.callSession.updateMany({
        where: { id: callId, status: { in: [...OPEN_CALL_STATUSES] } },
        data: {
          status,
          endedById,
          endedAt,
          durationSeconds,
          failureReason: failureReason?.trim().slice(0, 160) || null,
        },
      });
      if (updatedCount.count !== 1) {
        const current = await transaction.callSession.findUniqueOrThrow({ where: { id: callId } });
        return { call: this.toDescriptor(current), messageId: null };
      }
      const message = await transaction.chatMessage.create({
        data: {
          conversationId: existing.conversationId,
          senderId: endedById ?? existing.callerId,
          callSessionId: existing.id,
          body: this.callMessage(existing.type, status, durationSeconds),
          type: ChatMessageType.system,
        },
        select: { id: true },
      });
      await transaction.conversation.update({
        where: { id: existing.conversationId },
        data: { updatedAt: endedAt },
      });
      await transaction.conversationParticipantState.updateMany({
        where: { conversationId: existing.conversationId },
        data: { hidden: false },
      });
      const updated = await transaction.callSession.findUniqueOrThrow({ where: { id: callId } });
      return { call: this.toDescriptor(updated), messageId: message.id };
    });
  }

  async getCallResponse(callId: number, viewerId: number): Promise<CallSessionResponse> {
    const call = await this.prisma.callSession.findUnique({ where: { id: callId }, include: callInclude });
    if (!call) throw new NotFoundException("通话记录不存在。");
    if (![call.callerId, call.calleeId].includes(viewerId)) {
      throw new ForbiddenException("没有查看这通电话的权限。");
    }
    const counterpart = call.callerId === viewerId ? call.callee : call.caller;
    return {
      id: call.id,
      conversationId: call.conversationId,
      type: call.type,
      status: call.status,
      callerId: call.callerId,
      calleeId: call.calleeId,
      user: {
        id: counterpart.id,
        nickname: counterpart.nickname,
        username: counterpart.username,
        avatarUrl: counterpart.avatarStoredName ? `/users/${counterpart.id}/avatar` : null,
        profileBio: counterpart.profileBio,
        isSuperAdmin: counterpart.isSuperAdmin,
        role: counterpart.role,
        createdAt: counterpart.createdAt.toISOString(),
      },
      acceptedAt: call.acceptedAt?.toISOString() ?? null,
      endedAt: call.endedAt?.toISOString() ?? null,
      durationSeconds: call.durationSeconds,
      createdAt: call.createdAt.toISOString(),
      updatedAt: call.updatedAt.toISOString(),
    };
  }

  getIceServers(userId: number): IceServerConfigResponse {
    const host = (process.env.TURN_HOST ?? process.env.TURN_REALM ?? "").trim().replace(/^turns?:\/\//, "");
    const port = this.integerEnvironment("TURN_PORT", 3478, 1, 65535);
    const ttlSeconds = this.integerEnvironment("TURN_CREDENTIAL_TTL_SECONDS", 3600, 300, 86_400);
    const configuredStun = (process.env.STUN_URLS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const stunUrls = configuredStun.length
      ? configuredStun
      : host ? [`stun:${host}:${port}`] : ["stun:stun.cloudflare.com:3478"];
    const iceServers: IceServerConfigResponse["iceServers"] = [{ urls: stunUrls }];
    const secret = process.env.TURN_SECRET?.trim();
    if (!host || !secret) return { iceServers, expiresAt: null };
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiresAtSeconds}:${userId}`;
    const credential = createHmac("sha1", secret).update(username).digest("base64");
    iceServers.push({
      urls: [
        `turn:${host}:${port}?transport=udp`,
        `turn:${host}:${port}?transport=tcp`,
      ],
      username,
      credential,
    });
    return { iceServers, expiresAt: new Date(expiresAtSeconds * 1000).toISOString() };
  }

  private async getDescriptor(callId: number): Promise<CallDescriptor> {
    const call = await this.prisma.callSession.findUnique({ where: { id: callId } });
    if (!call) throw new NotFoundException("通话记录不存在。");
    return this.toDescriptor(call);
  }

  private async assertParticipant(callId: number, userId: number): Promise<void> {
    const call = await this.prisma.callSession.findUnique({
      where: { id: callId },
      select: { callerId: true, calleeId: true },
    });
    if (!call || ![call.callerId, call.calleeId].includes(userId)) {
      throw new ForbiddenException("没有操作这通电话的权限。");
    }
  }

  private toDescriptor(call: {
    id: number;
    conversationId: number;
    callerId: number;
    calleeId: number;
    type: CallType;
    status: CallStatus;
  }): CallDescriptor {
    return {
      id: call.id,
      conversationId: call.conversationId,
      callerId: call.callerId,
      calleeId: call.calleeId,
      type: call.type,
      status: call.status,
    };
  }

  private callMessage(type: CallType, status: CallStatus, durationSeconds: number | null): string {
    const label = type === CallType.video ? "视频通话" : "语音通话";
    if (status === CallStatus.completed) return `${label} · ${this.formatDuration(durationSeconds ?? 0)}`;
    if (status === CallStatus.declined) return `${label} · 已拒绝`;
    if (status === CallStatus.busy) return `${label} · 对方忙线`;
    if (status === CallStatus.cancelled) return `${label} · 已取消`;
    if (status === CallStatus.missed) return `${label} · 未接听`;
    return `${label} · 连接失败`;
  }

  private formatDuration(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  private integerEnvironment(name: string, fallback: number, minimum: number, maximum: number): number {
    const value = Number(process.env[name] ?? fallback);
    return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
  }
}
