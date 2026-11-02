import { Inject, Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

/** Kiểm tra Redis còn sống bằng lệnh PING. */
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    super();
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      const reply = await this.redis.ping();
      if (reply !== 'PONG') {
        throw new Error(`Phản hồi PING không hợp lệ: ${reply}`);
      }
      return this.getStatus(key, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HealthCheckError(
        'Redis không phản hồi',
        this.getStatus(key, false, { message }),
      );
    }
  }
}
