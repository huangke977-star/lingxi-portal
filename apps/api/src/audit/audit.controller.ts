import { Controller, Get, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { AuditService } from "./audit.service";
import { ListAuditLogsQueryDto } from "./dto/audit.dto";

@Controller("admin/audit")
@UseGuards(JwtAuthGuard, UserManagementGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(@Query() query: ListAuditLogsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.auditService.list(query, user);
  }

  @Get("export")
  @UseGuards(SuperAdminGuard)
  async export(
    @Query() query: ListAuditLogsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    response.set({
      "Cache-Control": "private, no-store",
      "Content-Disposition": "attachment; filename=audit-log.csv",
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });
    return `\uFEFF${await this.auditService.export(query, user)}`;
  }
}
