import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsQueryDto, RebuildAnalyticsDto } from "./dto/analytics.dto";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get("admin")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  getAdminAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getAdminAnalytics(query.range);
  }

  @Post("admin/rebuild")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  rebuild(@CurrentUser() user: AuthenticatedUser, @Body() dto: RebuildAnalyticsDto) {
    return this.analyticsService.rebuildRange(dto.range, user.id);
  }
}
