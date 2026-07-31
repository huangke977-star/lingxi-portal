import { Module } from '@nestjs/common';
import { AndroidReleasesModule } from './android-releases/android-releases.module';
import { AuthModule } from './auth/auth.module';
import { BackgroundsModule } from './backgrounds/backgrounds.module';
import { CacheAdminModule } from './cache-admin/cache-admin.module';
import { ArticlesModule } from './articles/articles.module';
import { HealthModule } from './health/health.module';
import { PortalModule } from './portal/portal.module';
import { RolesModule } from './roles/roles.module';
import { SiteSettingsModule } from './site-settings/site-settings.module';
import { SocialModule } from './social/social.module';

@Module({
  imports: [HealthModule, RolesModule, SiteSettingsModule, AuthModule, BackgroundsModule, AndroidReleasesModule, CacheAdminModule, PortalModule, ArticlesModule, SocialModule],
})
export class AppModule {}
