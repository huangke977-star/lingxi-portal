import { forwardRef, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { ArticlesModule } from "../articles/articles.module";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { SocialModule } from "../social/social.module";
import { ContentModerationService } from "./content-moderation.service";
import { ModerationController } from "./moderation.controller";
import { ModerationService } from "./moderation.service";
import { ModerationWorkflowService } from "./moderation-workflow.service";

@Module({
  imports: [JwtModule.register({}), PrismaModule, RedisModule, UsersModule, forwardRef(() => ArticlesModule), forwardRef(() => SocialModule)],
  controllers: [ModerationController],
  providers: [ModerationService, ContentModerationService, ModerationWorkflowService, JwtAuthGuard, UserManagementGuard, SuperAdminGuard],
  exports: [ContentModerationService],
})
export class ModerationModule {}
