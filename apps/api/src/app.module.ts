import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BackgroundsModule } from './backgrounds/backgrounds.module';
import { CacheAdminModule } from './cache-admin/cache-admin.module';
import { HealthModule } from './health/health.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [HealthModule, RolesModule, AuthModule, BackgroundsModule, CacheAdminModule],
})
export class AppModule {}
