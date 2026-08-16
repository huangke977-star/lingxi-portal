import { Controller, Get, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { ReputationService } from "./reputation.service";

@Controller("reputation")
@UseGuards(JwtAuthGuard)
export class ReputationController {
  constructor(private readonly reputationService: ReputationService) {}

  @Get("me")
  getMySummary(@CurrentUser() user: AuthenticatedUser) {
    return this.reputationService.getMySummary(user.id);
  }
}
