import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { SiteSettingsModule } from '../site-settings/site-settings.module';
import { AndroidReleasesController } from './android-releases.controller';
import { AndroidReleasesService } from './android-releases.service';

@Module({
  imports: [JwtModule.register({}), UsersModule, SiteSettingsModule],
  controllers: [AndroidReleasesController],
  providers: [AndroidReleasesService],
})
export class AndroidReleasesModule {}
