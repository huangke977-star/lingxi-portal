import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SocialService } from "./social.service";

@Controller("profiles")
export class PublicProfilesController {
  constructor(private readonly socialService: SocialService) {}

  @Get("public/:username")
  getPublic(@Param("username") username: string) {
    return this.socialService.getProfileByUsername(username, null);
  }

  @Get("visible/:username")
  @UseGuards(JwtAuthGuard)
  getVisible(@Param("username") username: string, @CurrentUser() user: AuthenticatedUser) {
    return this.socialService.getProfileByUsername(username, user);
  }
}
