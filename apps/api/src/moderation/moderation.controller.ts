import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { ListModerationReportsQueryDto } from "./dto/moderation.dto";
import { ModerationService } from "./moderation.service";

@Controller("moderation")
@UseGuards(JwtAuthGuard, UserManagementGuard)
export class ModerationController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get("reports")
  listReports(@Query() query: ListModerationReportsQueryDto) {
    return this.moderationService.listReports(query);
  }

  @Get("reports/summary")
  getSummary() {
    return this.moderationService.getSummary();
  }
}
