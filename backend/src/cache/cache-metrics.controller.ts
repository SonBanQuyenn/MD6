import { Controller, Delete, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { CacheMetrics } from './cache-metrics';

/** Chỉ số cache (NFR-PERF-04: tỉ lệ trúng ≥ 80%) — chỉ ADMIN. */
@Controller('admin/metrics/cache')
@Roles(Role.ADMIN)
export class CacheMetricsController {
  constructor(private readonly metrics: CacheMetrics) {}

  @Get()
  get() {
    return this.metrics.snapshot();
  }

  /** Đặt lại bộ đếm trước khi đo (ví dụ trước khi chạy k6). */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  reset() {
    this.metrics.reset();
  }
}
