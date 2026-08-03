import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
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
}
