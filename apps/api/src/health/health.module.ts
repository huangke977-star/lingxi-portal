import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { SystemStatusModule } from '../system-status/system-status.module';

@Module({
  imports: [SystemStatusModule],
  controllers: [HealthController],
})
export class HealthModule {}
