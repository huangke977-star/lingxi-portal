import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { RolesModule } from './roles/roles.module';

@Module({
  imports: [HealthModule, RolesModule],
})
export class AppModule {}
