import { Body, Controller, Get, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { UserManagementGuard } from "../auth/guards/user-management.guard";
import { AccountSecurityService } from "./account-security.service";
import { SecurityAdminQueryDto, UpdateSecurityConfigurationDto } from "./dto/security.dto";
import { MailService } from "./mail.service";
import { SecurityConfigurationService } from "./security-configuration.service";

@Controller("security-admin")
@UseGuards(JwtAuthGuard, UserManagementGuard)
export class SecurityAdminController {
  constructor(
    private readonly configuration: SecurityConfigurationService,
    private readonly mail: MailService,
    private readonly accountSecurity: AccountSecurityService,
  ) {}

  @Get("config")
  getConfiguration() {
    return this.configuration.getAdminConfiguration();
  }

  @Patch("config")
  @UseGuards(SuperAdminGuard)
  updateConfiguration(@Body() dto: UpdateSecurityConfigurationDto) {
    return this.configuration.update(dto);
  }

  @Post("smtp/test")
  @UseGuards(SuperAdminGuard)
  testSmtp() {
    return this.mail.testConnection();
  }

  @Get("overview")
  listOverview(@Query() query: SecurityAdminQueryDto) {
    return this.accountSecurity.listAdminOverview(query);
  }
}
