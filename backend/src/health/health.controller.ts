import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisHealthIndicator } from './redis.health';

@Controller('health')
@Public()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealth: PrismaHealthIndicator,
    private readonly redisHealth: RedisHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /api/health — trạng thái kết nối PostgreSQL và Redis (yêu cầu F07.1).
   * Tất cả "up" → 200; có thành phần "down" → 503.
   */
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
      () => this.redisHealth.pingCheck('redis'),
    ]);
  }

  /**
   * GET /api/health/live — chỉ cho biết tiến trình còn chạy (không kiểm tra DB/Redis).
   * Docker dùng endpoint này để quyết định có khởi động lại container hay không.
   */
  @Get('live')
  @HealthCheck()
  live() {
    return this.health.check([]);
  }
}
