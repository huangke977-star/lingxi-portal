import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthModule } from "../auth/auth.module";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { AnonymousTopicsController } from "./anonymous-topics.controller";
import { AnonymousTopicsService } from "./anonymous-topics.service";

@Module({
  imports: [JwtModule.register({}), AuthModule, RedisModule, UsersModule],
  controllers: [AnonymousTopicsController],
  providers: [AnonymousTopicsService],
})
export class AnonymousTopicsModule {}
