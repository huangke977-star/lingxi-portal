import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { RedisModule } from "../redis/redis.module";
import { UsersModule } from "../users/users.module";
import { SystemStatusController } from "./system-status.controller";
import { SystemStatusService } from "./system-status.service";
import { StorageManagementService } from "./storage-management.service";
import { BackupCryptoService } from "./backup-crypto.service";
import { BackupRemoteService } from "./backup-remote.service";
import { BackupService } from "./backup.service";

@Module({
  imports: [JwtModule.register({}), RedisModule, UsersModule],
  controllers: [SystemStatusController],
  providers: [BackupCryptoService, BackupRemoteService, BackupService, StorageManagementService, SystemStatusService],
})
export class SystemStatusModule {}
