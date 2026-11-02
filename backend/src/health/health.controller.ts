import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';
import { SkipRateLimit } from '../rate-limit/rate-limit.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisHealthIndicator } from './redis.health';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('Health — giám sát')
@Controller('health')
@Public()
@SkipRateLimit()
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
   * GET /api/health/ready — bản API có sẵn sàng nhận khách chưa (dùng khi DEPLOY blue/green).
   * Chỉ bắt buộc PostgreSQL: Redis hỏng thì hệ thống vẫn phục vụ được ở chế độ suy giảm
   * (cache bỏ qua, rate limit fail-open) — không nên vì vậy mà chặn deploy / rút traffic.
   */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prismaHealth.pingCheck('database', this.prisma),
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
