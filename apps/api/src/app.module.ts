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
import { SystemStatusModule } from './system-status/system-status.module';
import { AuditModule } from './audit/audit.module';
import { SearchModule } from './search/search.module';
import { PrismaModule } from './prisma/prisma.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { DiscoveryModule } from './discovery/discovery.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { SuggestionsModule } from './suggestions/suggestions.module';
import { AnonymousTopicsModule } from './anonymous-topics/anonymous-topics.module';
import { ReputationModule } from './reputation/reputation.module';
import { FeedbackModule } from './feedback/feedback.module';
import { ModerationModule } from './moderation/moderation.module';
import { AccountPrivacyModule } from './account-privacy/account-privacy.module';
import { DistributionModule } from './distribution/distribution.module';
import { ResourcesModule } from './resources/resources.module';

@Module({
  imports: [PrismaModule, HealthModule, RolesModule, SiteSettingsModule, AuthModule, AuditModule, SearchModule, BackgroundsModule, AndroidReleasesModule, CacheAdminModule, SystemStatusModule, PortalModule, ReputationModule, ArticlesModule, SocialModule, AnalyticsModule, DiscoveryModule, AnnouncementsModule, SuggestionsModule, AnonymousTopicsModule, FeedbackModule, ModerationModule, AccountPrivacyModule, DistributionModule, ResourcesModule],
})
export class AppModule {}
