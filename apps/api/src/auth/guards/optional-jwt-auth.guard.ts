import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UsersService } from "../../users/users.service";
import { RedisService } from "../../redis/redis.service";
import { AccessTokenPayload, AuthenticatedUser } from "../auth.types";

@Injectable()
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      user?: AuthenticatedUser;
      sessionId?: string | null;
    }>();
    const token = this.extractBearerToken(request.headers.authorization);
    if (!token) return true;
    try {
      const payload = await this.jwtService.verifyAsync<AccessTokenPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET ?? "dev-access-token-secret",
      });
      const user = await this.usersService.findActiveById(payload.sub);
      if ((payload.av ?? 0) !== (user.authVersion ?? 0)) return true;
      if (payload.sid) {
        const session = await this.redis.get(`refresh_token:${payload.sid}`);
        if (!session || !this.sessionBelongsToUser(session, payload.sub)) return true;
      }
      request.user = user;
      request.sessionId = payload.sid ?? null;
    } catch {
      // A public attachment request may omit authentication. Protected content is checked by its owner service.
    }
    return true;
  }

  private sessionBelongsToUser(session: string, userId: number): boolean {
    try {
      return (JSON.parse(session) as { userId?: number }).userId === userId;
    } catch {
      return false;
    }
  }

  private extractBearerToken(authorization?: string): string | null {
    if (!authorization) return null;
    const [scheme, token] = authorization.split(" ");
    return scheme === "Bearer" && token ? token : null;
  }
}
