import { Injectable } from '@nestjs/common';

export interface CacheMetricsSnapshot {
  hits: number;
  misses: number;
  /** Trúng "giá trị rỗng" — request dò khoá không tồn tại bị chặn ở cache */
  nullHits: number;
  /** Lỗi Redis → bỏ qua cache, đọc DB */
  errors: number;
  /** Request phải chờ request khác nạp cache (chống dồn dập) */
  lockWaits: number;
  hitRatio: number;
  since: string;
}

/**
 * Bộ đếm cache trong bộ nhớ của tiến trình (mỗi instance API tự đếm).
 * Dùng để đo chỉ tiêu NFR-PERF-04 "tỉ lệ trúng cache ≥ 80%".
 */
@Injectable()
export class CacheMetrics {
  private counters = {
    hits: 0,
    misses: 0,
    nullHits: 0,
    errors: 0,
    lockWaits: 0,
  };
  private since = new Date();

  hit(isNull = false): void {
    this.counters.hits++;
    if (isNull) this.counters.nullHits++;
  }
  miss(): void {
    this.counters.misses++;
  }
  error(): void {
    this.counters.errors++;
  }
  lockWait(): void {
    this.counters.lockWaits++;
  }

  snapshot(): CacheMetricsSnapshot {
    const lookups = this.counters.hits + this.counters.misses;
    return {
      ...this.counters,
      hitRatio: lookups === 0 ? 0 : +(this.counters.hits / lookups).toFixed(4),
      since: this.since.toISOString(),
    };
  }

  reset(): void {
    this.counters = {
      hits: 0,
      misses: 0,
      nullHits: 0,
      errors: 0,
      lockWaits: 0,
    };
    this.since = new Date();
  }
}
