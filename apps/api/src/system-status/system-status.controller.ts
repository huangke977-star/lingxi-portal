import { Body, Controller, Delete, Get, Param, Post, Res, StreamableFile, UseGuards } from "@nestjs/common";
import { createReadStream } from "node:fs";
import type { Response } from "express";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { SystemStatusService } from "./system-status.service";
import { SystemStatusResponse } from "./system-status.types";
import { RestoreBackupDto, TestBackupProviderDto, UpdateBackupConfigurationDto } from "./dto/backup.dto";

@Controller("admin/system")
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SystemStatusController {
  constructor(private readonly systemStatusService: SystemStatusService) {}

  @Get("status")
  getStatus(): Promise<SystemStatusResponse> {
    return this.systemStatusService.getStatus();
  }

  @Post("backups")
  createBackup() {
    return this.systemStatusService.createBackup();
  }

  @Get("backups/configuration")
  getBackupConfiguration() {
    return this.systemStatusService.getBackupConfiguration();
  }

  @Post("backups/configuration")
  updateBackupConfiguration(@Body() dto: UpdateBackupConfigurationDto) {
    return this.systemStatusService.updateBackupConfiguration(dto);
  }

  @Post("backups/providers/test")
  testBackupProvider(@Body() dto: TestBackupProviderDto) {
    return this.systemStatusService.testBackupProvider(dto.provider);
  }

  @Get("backups/:name/download")
  async downloadBackup(
    @Param("name") name: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const backup = await this.systemStatusService.getBackupDownload(name);
    response.set({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${backup.name}"`,
      "Content-Length": String(backup.sizeBytes),
      "Content-Type": backup.mimeType,
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(createReadStream(backup.filePath));
  }

  @Delete("backups/:name")
  deleteBackup(@Param("name") name: string) {
    return this.systemStatusService.deleteBackup(name);
  }

  @Post("backups/:name/restore")
  restoreBackup(@Param("name") name: string, @Body() dto: RestoreBackupDto) {
    return this.systemStatusService.restoreBackup(name, dto.confirmation);
  }
}
