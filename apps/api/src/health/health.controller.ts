import { Body, Controller, Get, HttpCode, Post, ServiceUnavailableException } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { LightweightMonitoringService } from '../system-status/lightweight-monitoring.service';

class ClientErrorDto {
  @IsIn(['window-error', 'unhandled-rejection', 'manual'])
  source!: 'window-error' | 'unhandled-rejection' | 'manual';

  @IsString()
  @MaxLength(500)
  message!: string;

  @IsString()
  @MaxLength(300)
  path!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  stack?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  buildId?: string;
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly monitoring: LightweightMonitoringService,
  ) {}

  @Get()
  getHealth() {
    return {
      status: 'ok',
      service: 'lingxi-api',
    };
  }

  @Get('ready')
  async getReadiness() {
    const checks = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    const database = checks[0];
    const redis = checks[1];
    const ready = database.ok && redis.ok;
    const payload = {
      status: ready ? 'ok' : 'degraded',
      service: 'lingxi-api',
      checks: { database, redis },
    };
    if (!ready) throw new ServiceUnavailableException(payload);
    return payload;
  }

  @Post('client-errors')
  @HttpCode(202)
  recordClientError(@Body() dto: ClientErrorDto) {
    this.monitoring.recordClientError({ ...dto, stack: dto.stack ?? null, buildId: dto.buildId ?? null });
    return { accepted: true };
  }

  private async checkDatabase(): Promise<{ ok: boolean; latencyMs: number | null }> {
    const startedAt = performance.now();
    try {
      await this.prisma.$queryRawUnsafe('SELECT 1');
      return { ok: true, latencyMs: Math.round((performance.now() - startedAt) * 10) / 10 };
    } catch {
      return { ok: false, latencyMs: Math.round((performance.now() - startedAt) * 10) / 10 };
    }
  }

  private async checkRedis(): Promise<{ ok: boolean; latencyMs: number | null }> {
    const startedAt = performance.now();
    try {
      await this.redis.ping();
      return { ok: true, latencyMs: Math.round((performance.now() - startedAt) * 10) / 10 };
    } catch {
      return { ok: false, latencyMs: Math.round((performance.now() - startedAt) * 10) / 10 };
    }
  }
}
