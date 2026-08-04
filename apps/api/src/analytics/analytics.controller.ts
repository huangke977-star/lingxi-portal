import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsQueryDto } from "./dto/analytics.dto";

@Controller("analytics")
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get("admin")
  @UseGuards(JwtAuthGuard, UserManagementGuard)
  getAdminAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getAdminAnalytics(query.range);
  }
}
