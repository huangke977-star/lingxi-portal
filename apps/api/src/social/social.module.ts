import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { ChatGateway } from "./chat.gateway";
import { SocialController } from "./social.controller";
import { SocialService } from "./social.service";

@Module({
  imports: [JwtModule.register({}), UsersModule, RedisModule],
  controllers: [SocialController],
  providers: [PrismaService, SocialService, ChatGateway],
  exports: [SocialService],
})
export class SocialModule {}
