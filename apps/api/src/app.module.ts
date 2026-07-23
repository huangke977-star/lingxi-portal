import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { BackgroundsModule } from './backgrounds/backgrounds.module';
import { CacheAdminModule } from './cache-admin/cache-admin.module';
import { ArticlesModule } from './articles/articles.module';
import { HealthModule } from './health/health.module';
import { PortalModule } from './portal/portal.module';
import { RolesModule } from './roles/roles.module';
import { SocialModule } from './social/social.module';

@Module({
  imports: [HealthModule, RolesModule, AuthModule, BackgroundsModule, CacheAdminModule, PortalModule, ArticlesModule, SocialModule],
})
export class AppModule {}
