import { Controller, Get, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { SystemStatusService } from "./system-status.service";
import { SystemStatusResponse } from "./system-status.types";

@Controller("admin/system")
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SystemStatusController {
  constructor(private readonly systemStatusService: SystemStatusService) {}

  @Get("status")
  getStatus(): Promise<SystemStatusResponse> {
    return this.systemStatusService.getStatus();
  }
}
