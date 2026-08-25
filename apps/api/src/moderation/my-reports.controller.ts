import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ModerationService } from "./moderation.service";

@Controller("moderation")
@UseGuards(JwtAuthGuard)
export class MyReportsController {
  constructor(private readonly moderationService: ModerationService) {}

  @Get("my-reports")
  listMyReports(@CurrentUser() user: AuthenticatedUser) {
    return this.moderationService.listMyReports(user);
  }
}
