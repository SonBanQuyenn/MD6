import { SetMetadata } from '@nestjs/common';
import { PolicyName } from './rate-limit.policies';

export const RATE_LIMIT_KEY = 'rateLimitPolicy';

/** Gắn thêm hạn mức chặt hơn cho endpoint nhạy cảm, ví dụ `@RateLimit('login')`. */
export const RateLimit = (policy: Exclude<PolicyName, 'global'>) =>
  SetMetadata(RATE_LIMIT_KEY, policy);
