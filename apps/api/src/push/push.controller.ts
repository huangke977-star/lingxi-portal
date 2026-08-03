import { Body, Controller, Delete, Get, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PushSubscriptionDto } from "./dto/push.dto";
import { PushService } from "./push.service";

@Controller("push")
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get("config")
  getConfig() {
    return this.pushService.getConfig();
  }

  @Get("status")
  @UseGuards(JwtAuthGuard)
  getStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.pushService.getStatus(user);
  }

  @Post("subscriptions")
  @UseGuards(JwtAuthGuard)
  subscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: PushSubscriptionDto, @Req() request: Request) {
    return this.pushService.subscribe(user, dto, request.headers["user-agent"] ?? "");
  }

  @Delete("subscriptions")
  @UseGuards(JwtAuthGuard)
  unsubscribe(@CurrentUser() user: AuthenticatedUser, @Body() dto: PushSubscriptionDto) {
    return this.pushService.unsubscribe(user, dto);
  }
}
