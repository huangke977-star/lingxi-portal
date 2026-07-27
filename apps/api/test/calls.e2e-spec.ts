import { createHmac } from "node:crypto";
import { CallStatus, CallType, FriendshipStatus } from "../src/generated/prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { CallsService } from "../src/social/calls.service";

describe("CallsService", () => {
  afterEach(() => {
    delete process.env.TURN_HOST;
    delete process.env.TURN_REALM;
    delete process.env.TURN_SECRET;
    delete process.env.TURN_PORT;
    delete process.env.TURN_CREDENTIAL_TTL_SECONDS;
    delete process.env.STUN_URLS;
  });

  it("creates short-lived coturn REST credentials without exposing the shared secret", () => {
    process.env.TURN_HOST = "turn.example.com";
    process.env.TURN_REALM = "turn.example.com";
    process.env.TURN_SECRET = "test-turn-secret";
    process.env.TURN_CREDENTIAL_TTL_SECONDS = "600";
    const service = new CallsService({} as PrismaService);

    const result = service.getIceServers(7);
    const turn = result.iceServers[1];
    const username = turn.username ?? "";

    expect(turn.urls).toEqual([
      "turn:turn.example.com:3478?transport=udp",
      "turn:turn.example.com:3478?transport=tcp",
    ]);
    expect(username.endsWith(":7")).toBe(true);
    expect(turn.credential).toBe(createHmac("sha1", "test-turn-secret").update(username).digest("base64"));
    expect(JSON.stringify(result)).not.toContain("test-turn-secret");
  });

  it("starts a call only inside an accepted friendship conversation", async () => {
    const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({
      id: 31,
      status: CallStatus.ringing,
      ...args.data,
    }));
    const prisma = {
      conversation: {
        findUnique: jest.fn(async () => ({
          id: 5,
          friendship: { userOneId: 7, userTwoId: 8, status: FriendshipStatus.accepted },
        })),
      },
      callSession: { findFirst: jest.fn(async () => null), create },
    };
    const service = new CallsService(prisma as unknown as PrismaService);

    await expect(service.startCall(7, 5, CallType.video)).resolves.toEqual(expect.objectContaining({
      id: 31,
      callerId: 7,
      calleeId: 8,
      conversationId: 5,
      type: CallType.video,
      status: CallStatus.ringing,
    }));
    expect(create).toHaveBeenCalledWith({
      data: { conversationId: 5, callerId: 7, calleeId: 8, type: CallType.video },
    });
  });

  it("persists a terminal call state and a compact conversation record", async () => {
    const acceptedAt = new Date(Date.now() - 65_000);
    const existing = {
      id: 31,
      conversationId: 5,
      callerId: 7,
      calleeId: 8,
      endedById: null,
      type: CallType.voice,
      status: CallStatus.active,
      acceptedAt,
      endedAt: null,
      durationSeconds: null,
      failureReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      caller: {},
      callee: {},
    };
    const chatMessageCreate = jest.fn(async () => ({ id: 44 }));
    const transaction = {
      callSession: {
        findUnique: jest.fn(async () => existing),
        updateMany: jest.fn(async () => ({ count: 1 })),
        findUniqueOrThrow: jest.fn(async () => ({
          ...existing,
          status: CallStatus.completed,
          endedAt: new Date(),
          durationSeconds: 65,
        })),
      },
      chatMessage: { create: chatMessageCreate },
      conversation: { update: jest.fn(async () => ({ id: 5 })) },
      conversationParticipantState: { updateMany: jest.fn(async () => ({ count: 2 })) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    const service = new CallsService(prisma as unknown as PrismaService);

    const result = await service.finishCall(31, CallStatus.completed, 7);

    expect(result.messageId).toBe(44);
    expect(chatMessageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        conversationId: 5,
        senderId: 7,
        callSessionId: 31,
        type: "system",
        body: expect.stringMatching(/^语音通话 · 01:0[45]$/),
      }),
    }));
  });
});
