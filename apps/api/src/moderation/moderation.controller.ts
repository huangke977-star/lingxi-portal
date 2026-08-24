import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import {
  BulkHandleModerationReportsDto,
  CreateModerationRuleDto,
  CreateModerationTemplateDto,
  ListModerationReportsQueryDto,
  ListModerationRuleHitsQueryDto,
  UpdateModerationRuleDto,
  UpdateModerationSettingsDto,
  UpdateModerationTemplateDto,
} from "./dto/moderation.dto";
import { ModerationService } from "./moderation.service";
import { ModerationWorkflowService } from "./moderation-workflow.service";

@Controller("moderation")
@UseGuards(JwtAuthGuard, UserManagementGuard)
export class ModerationController {
  constructor(
    private readonly moderationService: ModerationService,
    private readonly moderationWorkflowService: ModerationWorkflowService,
  ) {}

  @Get("reports")
  listReports(@Query() query: ListModerationReportsQueryDto) {
    return this.moderationService.listReports(query);
  }

  @Get("reports/summary")
  getSummary() {
    return this.moderationService.getSummary();
  }

  @Get("overview")
  getOverview() { return this.moderationService.getOverview(); }

  @Get("rules")
  listRules() { return this.moderationService.listRules(); }

  @Post("rules")
  @UseGuards(SuperAdminGuard)
  createRule(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateModerationRuleDto) { return this.moderationService.createRule(user, dto); }

  @Patch("rules/:id")
  @UseGuards(SuperAdminGuard)
  updateRule(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateModerationRuleDto) { return this.moderationService.updateRule(user, id, dto); }

  @Delete("rules/:id")
  @UseGuards(SuperAdminGuard)
  deleteRule(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) { return this.moderationService.deleteRule(user, id); }

  @Get("rule-hits")
  listRuleHits(@Query() query: ListModerationRuleHitsQueryDto) { return this.moderationService.listRuleHits(query); }

  @Get("templates")
  listTemplates() { return this.moderationService.listTemplates(); }

  @Post("templates")
  @UseGuards(SuperAdminGuard)
  createTemplate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateModerationTemplateDto) { return this.moderationService.createTemplate(user, dto); }

  @Patch("templates/:id")
  @UseGuards(SuperAdminGuard)
  updateTemplate(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateModerationTemplateDto) { return this.moderationService.updateTemplate(user, id, dto); }

  @Delete("templates/:id")
  @UseGuards(SuperAdminGuard)
  deleteTemplate(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) { return this.moderationService.deleteTemplate(user, id); }

  @Get("settings")
  getSettings() { return this.moderationService.getSettings(); }

  @Put("settings")
  @UseGuards(SuperAdminGuard)
  updateSettings(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateModerationSettingsDto) { return this.moderationService.updateSettings(user, dto); }

  @Post("reports/bulk")
  handleBatch(@CurrentUser() user: AuthenticatedUser, @Body() dto: BulkHandleModerationReportsDto) { return this.moderationWorkflowService.handleBatch(user, dto); }
}
