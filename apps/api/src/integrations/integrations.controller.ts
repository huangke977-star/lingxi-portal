import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { CreateExternalChannelDto, CreateReadOnlyTokenDto, CreateWebhookDto, ReadOnlyArticlesQueryDto, UpdateExternalChannelDto, UpdateWebhookDto, VerifyExternalChannelDto } from "./dto/integrations.dto";
import { IntegrationsService } from "./integrations.service";

@Controller("integrations")
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get("admin/webhooks") @UseGuards(JwtAuthGuard, UserManagementGuard, SuperAdminGuard) listWebhooks() { return this.integrations.listWebhooks(); }
  @Post("admin/webhooks") @UseGuards(JwtAuthGuard, UserManagementGuard, SuperAdminGuard) createWebhook(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWebhookDto) { return this.integrations.createWebhook(user, dto); }
  @Patch("admin/webhooks/:id") @UseGuards(JwtAuthGuard, UserManagementGuard, SuperAdminGuard) updateWebhook(@Param("id", ParseIntPipe) id: number, @Body() dto: UpdateWebhookDto) { return this.integrations.updateWebhook(id, dto); }
  @Delete("admin/webhooks/:id") @UseGuards(JwtAuthGuard, UserManagementGuard, SuperAdminGuard) deleteWebhook(@Param("id", ParseIntPipe) id: number) { return this.integrations.deleteWebhook(id); }
  @Get("admin/webhook-deliveries") @UseGuards(JwtAuthGuard, UserManagementGuard, SuperAdminGuard) listDeliveries(@Query("endpointId") endpointId?: string) { return this.integrations.listDeliveries(endpointId ? Number(endpointId) : undefined); }
  @Post("admin/webhook-deliveries/:id/replay") @UseGuards(JwtAuthGuard, UserManagementGuard, SuperAdminGuard) replayDelivery(@Param("id", ParseIntPipe) id: number) { return this.integrations.replayDelivery(id); }
  @Post("admin/webhooks/test") @UseGuards(JwtAuthGuard, UserManagementGuard, SuperAdminGuard) testWebhook() { return this.integrations.emit("integration.test", { source: "admin" }); }

  @Get("tokens") @UseGuards(JwtAuthGuard) listTokens(@CurrentUser() user: AuthenticatedUser) { return this.integrations.listTokens(user); }
  @Post("tokens") @UseGuards(JwtAuthGuard) createToken(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateReadOnlyTokenDto) { return this.integrations.createToken(user, dto); }
  @Delete("tokens/:id") @UseGuards(JwtAuthGuard) revokeToken(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) { return this.integrations.revokeToken(user, id); }

  @Get("external-channels") @UseGuards(JwtAuthGuard) listChannels(@CurrentUser() user: AuthenticatedUser) { return this.integrations.listChannels(user); }
  @Post("external-channels") @UseGuards(JwtAuthGuard) createChannel(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExternalChannelDto) { return this.integrations.createChannel(user, dto); }
  @Post("external-channels/:id/verify") @UseGuards(JwtAuthGuard) verifyChannel(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: VerifyExternalChannelDto) { return this.integrations.verifyChannel(user, id, dto.code); }
  @Patch("external-channels/:id") @UseGuards(JwtAuthGuard) updateChannel(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number, @Body() dto: UpdateExternalChannelDto) { return this.integrations.updateChannel(user, id, dto); }
  @Delete("external-channels/:id") @UseGuards(JwtAuthGuard) deleteChannel(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) { return this.integrations.deleteChannel(user, id); }

  @Get("v1/articles") listReadOnlyArticles(@Req() request: Request, @Query() query: ReadOnlyArticlesQueryDto) { return this.integrations.listReadOnlyArticles(request.headers.authorization, query.search, query.limit); }
  @Get("v1/notifications") listReadOnlyNotifications(@Req() request: Request, @Query("limit") rawLimit?: string) {
    const limit = Math.min(50, Math.max(1, Number(rawLimit) || 20));
    return this.integrations.listReadOnlyNotifications(request.headers.authorization, limit);
  }
  @Get("v1/users/:username") getReadOnlyProfile(@Req() request: Request, @Param("username") username: string) { return this.integrations.getReadOnlyProfile(request.headers.authorization, username); }
}
