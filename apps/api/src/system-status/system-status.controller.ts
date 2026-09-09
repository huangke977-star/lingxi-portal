import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { createReadStream } from "node:fs";
import type { Response } from "express";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { SuperAdminGuard } from "../auth/guards/super-admin.guard";
import { SystemStatusService } from "./system-status.service";
import { SystemStatusResponse } from "./system-status.types";
import {
  DeleteBackupsDto,
  RestoreBackupDto,
  TestBackupProviderDto,
  UpdateBackupConfigurationDto,
} from "./dto/backup.dto";
import {
  StorageIssueQueryDto,
  StorageTrashQueryDto,
  UpdateStorageManagementConfigurationDto,
} from "./dto/storage-management.dto";
import { StorageManagementService } from "./storage-management.service";
import { P21OperationsService } from "./p21-operations.service";
import { P22QualityService } from "./p22-quality.service";
import {
  OperationalAlertQueryDto,
  OperationalRunQueryDto,
  StartLoadTestDto,
  StartRecoveryDrillDto,
  UpdateAuditRetentionPolicyDto,
} from "./dto/p21-operations.dto";
import {
  ConfirmStorageIssueUnrecoverableDto,
  MediaBackupFileQueryDto,
  MediaBackupJobQueryDto,
  RestoreMediaBackupFileDto,
  RestoreMissingStorageIssueDto,
} from "./dto/media-backup.dto";
import { MediaBackupService } from "./media-backup.service";
import {
  MEDIA_REPAIR_MAX_FILE_SIZE_BYTES,
  UploadedMediaRepairFile,
  createMediaRepairUploadStorage,
} from "./media-repair-upload.storage";

@Controller("admin/system")
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SystemStatusController {
  constructor(
    private readonly systemStatusService: SystemStatusService,
    private readonly storageManagementService: StorageManagementService,
    private readonly mediaBackupService: MediaBackupService,
    private readonly p21OperationsService: P21OperationsService,
    private readonly p22QualityService: P22QualityService,
  ) {}

  @Get("status")
  getStatus(): Promise<SystemStatusResponse> {
    return this.systemStatusService.getStatus();
  }

  @Post("backups")
  createBackup() {
    return this.systemStatusService.createBackup();
  }

  @Post("backups/batch-delete")
  deleteBackups(@Body() dto: DeleteBackupsDto) {
    return this.systemStatusService.deleteBackups(dto.names);
  }

  @Get("backups/:name/preflight")
  getRestorePreflight(@Param("name") name: string) {
    return this.systemStatusService.getRestorePreflight(name);
  }

  @Post("backups/:name/verify")
  verifyBackup(@Param("name") name: string) {
    return this.systemStatusService.verifyBackup(name);
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

  @Post("media-backups/jobs")
  startMediaBackup(@CurrentUser() user: AuthenticatedUser) {
    return this.mediaBackupService.startBackup(user.id);
  }

  @Get("media-backups/jobs")
  listMediaBackupJobs(@Query() query: MediaBackupJobQueryDto) {
    return this.mediaBackupService.listJobs(query);
  }

  @Get("media-backups/jobs/:id")
  getMediaBackupJob(@Param("id", ParseIntPipe) id: number) {
    return this.mediaBackupService.getJob(id);
  }

  @Get("media-backups/files")
  listMediaBackupFiles(@Query() query: MediaBackupFileQueryDto) {
    return this.mediaBackupService.listFiles(query);
  }

  @Post("media-backups/files/:id/restore")
  restoreMediaBackupFile(
    @Param("id", ParseIntPipe) id: number,
    @Body() dto: RestoreMediaBackupFileDto,
  ) {
    return this.mediaBackupService.restoreFile(
      id,
      dto.confirmation,
      dto.provider,
    );
  }

  @Get("storage")
  getStorageOverview() {
    return this.storageManagementService.getOverview();
  }

  @Post("storage/scans")
  startStorageScan(@CurrentUser() user: AuthenticatedUser) {
    return this.storageManagementService.startScan(user.id);
  }

  @Get("storage/scans/:id")
  getStorageScan(@Param("id", ParseIntPipe) id: number) {
    return this.storageManagementService.getScan(id);
  }

  @Get("storage/issues")
  listStorageIssues(@Query() query: StorageIssueQueryDto) {
    return this.storageManagementService.listIssues(query);
  }

  @Get("storage/issues/:id/file")
  async getStorageIssueFile(
    @Param("id", ParseIntPipe) id: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const file = await this.storageManagementService.getIssueFile(id);
    response.set({
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Content-Length": String(file.sizeBytes),
      "Content-Type": file.mimeType,
      "X-Content-Type-Options": "nosniff",
    });
    return new StreamableFile(createReadStream(file.filePath));
  }

  @Post("storage/issues/:id/trash")
  trashStorageIssue(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.storageManagementService.trashIssue(id, user.id);
  }

  @Post("storage/issues/:id/restore-remote")
  restoreMissingStorageIssue(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RestoreMissingStorageIssueDto,
  ) {
    return this.mediaBackupService.restoreMissingIssue(
      id,
      user.id,
      dto.provider,
    );
  }

  @Post("storage/issues/:id/reupload")
  @UseInterceptors(
    FileInterceptor("file", {
      storage: createMediaRepairUploadStorage(),
      limits: { fileSize: MEDIA_REPAIR_MAX_FILE_SIZE_BYTES, files: 1 },
    }),
  )
  reuploadMissingStorageIssue(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: UploadedMediaRepairFile | undefined,
  ) {
    return this.mediaBackupService.reuploadMissingIssue(id, user.id, file);
  }

  @Post("storage/issues/:id/confirm-unrecoverable")
  confirmMissingStorageIssueUnrecoverable(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmStorageIssueUnrecoverableDto,
  ) {
    return this.mediaBackupService.confirmMissingIssueUnrecoverable(
      id,
      user.id,
      dto.note,
    );
  }

  @Get("storage/issues/:id/repairs")
  listStorageIssueRepairs(@Param("id", ParseIntPipe) id: number) {
    return this.mediaBackupService.listIssueRepairs(id);
  }

  @Get("storage/trash")
  listStorageTrash(@Query() query: StorageTrashQueryDto) {
    return this.storageManagementService.listTrash(query);
  }

  @Post("storage/trash/:id/restore")
  restoreStorageTrash(@Param("id", ParseIntPipe) id: number) {
    return this.storageManagementService.restoreTrash(id);
  }

  @Delete("storage/trash/:id")
  deleteStorageTrash(@Param("id", ParseIntPipe) id: number) {
    return this.storageManagementService.deleteTrash(id);
  }

  @Get("storage/configuration")
  getStorageConfiguration() {
    return this.storageManagementService.getConfiguration();
  }

  @Post("storage/configuration")
  updateStorageConfiguration(
    @Body() dto: UpdateStorageManagementConfigurationDto,
  ) {
    return this.storageManagementService.updateConfiguration(dto);
  }

  @Get("operations/overview")
  getOperationsOverview() {
    return this.p21OperationsService.getOverview();
  }

  @Get("operations/runs")
  listOperationalRuns(@Query() query: OperationalRunQueryDto) {
    return this.p21OperationsService.listRuns(query);
  }

  @Post("operations/runs/alert-check")
  runAlertCheck(@CurrentUser() user: AuthenticatedUser) {
    return this.p21OperationsService.runAlertCheck(user.id);
  }

  @Post("operations/runs/dependency-review")
  runDependencyReview(@CurrentUser() user: AuthenticatedUser) {
    return this.p21OperationsService.runDependencyReview(user.id);
  }

  @Post("operations/recovery-drills")
  startRecoveryDrill(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartRecoveryDrillDto,
  ) {
    return this.p21OperationsService.startRecoveryDrill(user.id, dto);
  }

  @Post("operations/load-tests")
  startLoadTest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: StartLoadTestDto,
  ) {
    return this.p21OperationsService.startLoadTest(user.id, dto);
  }

  @Get("operations/alerts")
  listOperationalAlerts(@Query() query: OperationalAlertQueryDto) {
    return this.p21OperationsService.listAlerts(query);
  }

  @Post("operations/alerts/:id/acknowledge")
  acknowledgeOperationalAlert(
    @Param("id", ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.p21OperationsService.acknowledgeAlert(id, user.id);
  }

  @Post("operations/alerts/:id/resolve")
  resolveOperationalAlert(@Param("id", ParseIntPipe) id: number) {
    return this.p21OperationsService.resolveAlert(id);
  }

  @Get("operations/audit-policy")
  getAuditRetentionPolicy() {
    return this.p21OperationsService.getAuditPolicy();
  }

  @Post("operations/audit-policy")
  updateAuditRetentionPolicy(@Body() dto: UpdateAuditRetentionPolicyDto) {
    return this.p21OperationsService.updateAuditPolicy(dto);
  }

  @Post("operations/audit-cleanup")
  cleanupAuditLogs() {
    return this.p21OperationsService.cleanupAuditLogs();
  }

  @Get("quality/overview")
  getQualityOverview() {
    return this.p22QualityService.getOverview();
  }

  @Post("quality/release-check")
  runQualityCheck(@CurrentUser() user: AuthenticatedUser) {
    return this.p22QualityService.runQualityCheck(user.id);
  }
}
