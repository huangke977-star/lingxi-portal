import { JwtService } from "@nestjs/jwt";
import type { Namespace, Socket } from "socket.io";
import { RedisService } from "../src/redis/redis.service";
import { UsersService } from "../src/users/users.service";
import { CallsService } from "../src/social/calls.service";
import { ChatGateway } from "../src/social/chat.gateway";
import { SocialService } from "../src/social/social.service";
import { PushService } from "../src/push/push.service";

describe("ChatGateway session validation", () => {
  it("resolves connected sockets from the configured namespace", async () => {
    const redis = {
      get: jest.fn(async () => JSON.stringify({ userId: 7 })),
    };
    const gateway = new ChatGateway(
      {} as JwtService,
      {} as UsersService,
      {} as SocialService,
      {} as CallsService,
      redis as unknown as RedisService,
      {} as PushService,
    );
    const socket = {
      data: { userId: 7, sessionId: "session-1" },
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;
    const internals = gateway as unknown as {
      server: Namespace;
      socketsByUser: Map<number, Set<string>>;
      disconnectRevokedSessions(): Promise<void>;
    };
    internals.server = {
      sockets: new Map([["socket-1", socket]]),
    } as unknown as Namespace;
    internals.socketsByUser.set(7, new Set(["socket-1"]));

    await internals.disconnectRevokedSessions();

    expect(redis.get).toHaveBeenCalledWith("refresh_token:session-1");
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
});
