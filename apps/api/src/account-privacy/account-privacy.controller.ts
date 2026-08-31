import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { AuthenticatedUser, RefreshSessionContext } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { AccountPrivacyService } from "./account-privacy.service";
import { ListDeletedUsersQueryDto, PrivacyAuditQueryDto, RequestAccountDeletionDto, TotpCodeDto } from "./dto/account-privacy.dto";

@Controller("account-privacy")
@UseGuards(JwtAuthGuard)
export class AccountPrivacyController {
  constructor(private readonly privacy: AccountPrivacyService) {}

  @Get("me")
  getOverview(@CurrentUser() user: AuthenticatedUser, @Req() request: PrivacyRequest) {
    return this.privacy.getOverview(user, this.context(request));
  }

  @Get("me/audit")
  getAudit(@CurrentUser() user: AuthenticatedUser, @Query() query: PrivacyAuditQueryDto) {
    return this.privacy.listAudit(user, query.limit);
  }

  @Get("me/blocked")
  getBlocked(@CurrentUser() user: AuthenticatedUser) {
    return this.privacy.listBlockedUsers(user.id);
  }

  @Post("me/exports")
  requestExport(@CurrentUser() user: AuthenticatedUser, @Req() request: PrivacyRequest) {
    return this.privacy.requestExport(user, this.context(request));
  }

  @Get("me/exports/:id")
  getExport(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.privacy.getExport(user, id);
  }

  @Get("me/exports/:id/download")
  @Header("Content-Type", "application/json; charset=utf-8")
  async downloadExport(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id", ParseIntPipe) id: number,
    @Req() request: PrivacyRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader("Content-Disposition", `attachment; filename="lingxi-data-export-${id}.json"`);
    return this.privacy.downloadExport(user, id, this.context(request));
  }

  @Post("me/deletion")
  requestDeletion(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestAccountDeletionDto, @Req() request: PrivacyRequest) {
    return this.privacy.requestDeletion(user, dto.currentPassword, this.context(request));
  }

  @Patch("me/deletion/cancel")
  cancelDeletion(@CurrentUser() user: AuthenticatedUser, @Req() request: PrivacyRequest) {
    return this.privacy.cancelDeletion(user, this.context(request));
  }

  @Post("me/totp/enroll")
  enrollTotp(@CurrentUser() user: AuthenticatedUser, @Req() request: PrivacyRequest) {
    return this.privacy.beginTotpEnrollment(user, this.context(request));
  }

  @Post("me/totp/confirm")
  confirmTotp(@CurrentUser() user: AuthenticatedUser, @Body() dto: TotpCodeDto, @Req() request: PrivacyRequest) {
    return this.privacy.confirmTotp(user, dto.code, this.context(request));
  }

  @Patch("me/totp/disable")
  disableTotp(@CurrentUser() user: AuthenticatedUser, @Body() dto: TotpCodeDto, @Req() request: PrivacyRequest) {
    return this.privacy.disableTotp(user, dto.code, this.context(request));
  }

  @Get("admin/deleted-users")
  listDeletedUsers(@CurrentUser() user: AuthenticatedUser, @Query() query: ListDeletedUsersQueryDto) {
    return this.privacy.listDeletedUsers(user, query.search, query.page, query.pageSize);
  }

  @Get("admin/deleted-users/:id/content")
  getDeletedUserContent(@CurrentUser() user: AuthenticatedUser, @Param("id", ParseIntPipe) id: number) {
    return this.privacy.getDeletedUserContent(user, id);
  }

  private context(request: PrivacyRequest): RefreshSessionContext {
    const forwarded = request.headers?.["x-forwarded-for"];
    const userAgent = request.headers?.["user-agent"];
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
    return {
      ip: (value?.trim() || request.ip || "unknown").replace(/^::ffff:/, ""),
      userAgent: Array.isArray(userAgent) ? (userAgent[0] ?? "unknown") : (userAgent ?? "unknown"),
    };
  }
}

interface PrivacyRequest {
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
}
