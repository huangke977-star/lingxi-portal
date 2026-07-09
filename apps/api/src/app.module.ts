import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [HealthModule, RolesModule, AuthModule],
})
export class AppModule {}
