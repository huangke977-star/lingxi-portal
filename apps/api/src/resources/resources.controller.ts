import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { ResourceAdjustmentDto, ResourceFailureDto } from "./dto/resource.dto";
import { ResourcesService } from "./resources.service";

@Controller("resources")
@UseGuards(JwtAuthGuard)
export class ResourcesController {
  constructor(private readonly resourcesService: ResourcesService) {}

  @Get("mine/deliveries")
  listMine(@CurrentUser() user: AuthenticatedUser, @Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.resourcesService.listMine(user, Number(page ?? 1), Number(pageSize ?? 20));
  }

  @Post("deliveries/:id/download")
  download(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.resourcesService.download(id, user);
  }

  @Post("deliveries/:id/retry")
  retry(@Param("id", ParseIntPipe) id: number, @CurrentUser() user: AuthenticatedUser) {
    return this.resourcesService.retry(id, user);
  }

  @Get("creator/earnings")
  creatorEarnings(@CurrentUser() user: AuthenticatedUser) {
    return this.resourcesService.creatorEarnings(user);
  }

  @Get("admin/deliveries")
  @UseGuards(UserManagementGuard)
  listAdmin(@Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.resourcesService.listAdmin(Number(page ?? 1), Number(pageSize ?? 50));
  }

  @Get("admin/points/adjustments")
  @UseGuards(UserManagementGuard)
  listAdminPointAdjustments(@Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    return this.resourcesService.listAdminPointAdjustments(Number(page ?? 1), Number(pageSize ?? 50));
  }

  @Post("admin/deliveries/:id/fail")
  @UseGuards(SuperAdminGuard)
  markFailed(@Param("id", ParseIntPipe) id: number, @Body() dto: ResourceFailureDto) {
    return this.resourcesService.markFailed(id, dto);
  }

  @Post("admin/deliveries/:id/refund")
  @UseGuards(SuperAdminGuard)
  refund(@Param("id", ParseIntPipe) id: number) {
    return this.resourcesService.refund(id);
  }

  @Post("admin/points/top-up")
  @UseGuards(SuperAdminGuard)
  topUp(@Body() dto: ResourceAdjustmentDto) {
    return this.resourcesService.topUp(dto);
  }

  @Post("admin/points/violation")
  @UseGuards(SuperAdminGuard)
  violation(@Body() dto: ResourceAdjustmentDto) {
    return this.resourcesService.violation(dto);
  }
}
