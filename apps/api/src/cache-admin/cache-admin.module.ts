import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { CacheAdminController } from "./cache-admin.controller";
import { CacheAdminService } from "./cache-admin.service";

@Module({
  imports: [JwtModule.register({}), RedisModule, UsersModule],
  controllers: [CacheAdminController],
  providers: [CacheAdminService],
})
export class CacheAdminModule {}
