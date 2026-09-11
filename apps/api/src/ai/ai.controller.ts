import { Body, Controller, DefaultValuePipe, Get, ParseIntPipe, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { ArticleAssistantDto, UpdateAiConfigurationDto } from "./dto/ai.dto";
import { AiService } from "./ai.service";

@Controller("ai/admin")
@UseGuards(JwtAuthGuard, UserManagementGuard, SuperAdminGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get("configuration")
  getConfiguration() {
    return this.ai.getAdminConfiguration();
  }

  @Patch("configuration")
  updateConfiguration(@Body() dto: UpdateAiConfigurationDto) {
    return this.ai.updateConfiguration(dto);
  }

  @Post("test-connection")
  testConnection(@CurrentUser() user: AuthenticatedUser) {
    return this.ai.testConnection(user.id);
  }

  @Get("invocations")
  getInvocations(@Query("limit", new DefaultValuePipe(30), ParseIntPipe) limit: number) {
    return this.ai.getAdminInvocationOverview(limit);
  }
}

@Controller("ai")
@UseGuards(JwtAuthGuard)
export class ArticleAiController {
  constructor(private readonly ai: AiService) {}

  @Post("article-assistant")
  articleAssistant(@CurrentUser() user: AuthenticatedUser, @Body() dto: ArticleAssistantDto) {
    return this.ai.articleAssistant(user.id, dto);
  }
}
