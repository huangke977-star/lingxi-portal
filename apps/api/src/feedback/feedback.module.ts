import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { FeedbackController } from "./feedback.controller";
import { FeedbackService } from "./feedback.service";

@Module({
  imports: [JwtModule.register({}), UsersModule, RedisModule],
  controllers: [FeedbackController],
  providers: [FeedbackService, JwtAuthGuard],
})
export class FeedbackModule {}
