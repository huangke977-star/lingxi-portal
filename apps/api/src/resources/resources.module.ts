import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ReputationModule } from "../reputation/reputation.module";
import { AuthModule } from "../auth/auth.module";
import { UsersModule } from "../users/users.module";
import { RedisModule } from "../redis/redis.module";
import { ResourcesController } from "./resources.controller";
import { ResourcesService } from "./resources.service";

@Module({
  imports: [JwtModule.register({}), AuthModule, UsersModule, RedisModule, ReputationModule],
  controllers: [ResourcesController],
  providers: [ResourcesService],
})
export class ResourcesModule {}
