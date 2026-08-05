import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { SystemStatusController } from "./system-status.controller";
import { SystemStatusService } from "./system-status.service";
import { StorageManagementService } from "./storage-management.service";
import { BackupCryptoService } from "./backup-crypto.service";
import { BackupOperationLockService } from "./backup-operation-lock.service";
import { BackupRemoteService } from "./backup-remote.service";
import { BackupService } from "./backup.service";
import { MediaBackupCatalogService } from "./media-backup-catalog.service";
import { MediaBackupService } from "./media-backup.service";
import { LightweightMonitoringInterceptor } from "./lightweight-monitoring.interceptor";
import { LightweightMonitoringService } from "./lightweight-monitoring.service";
import { ReliabilityOverviewService } from "./reliability-overview.service";

@Module({
  imports: [JwtModule.register({}), RedisModule, UsersModule],
  controllers: [SystemStatusController],
  providers: [
    BackupCryptoService,
    BackupOperationLockService,
    BackupRemoteService,
    BackupService,
    MediaBackupCatalogService,
    MediaBackupService,
    StorageManagementService,
    LightweightMonitoringService,
    ReliabilityOverviewService,
    SystemStatusService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LightweightMonitoringInterceptor,
    },
  ],
})
export class SystemStatusModule {}
