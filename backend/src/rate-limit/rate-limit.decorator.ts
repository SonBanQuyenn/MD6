import { SetMetadata } from '@nestjs/common';
import { PolicyName } from './rate-limit.policies';

export const RATE_LIMIT_KEY = 'rateLimitPolicy';
export const SKIP_RATE_LIMIT_KEY = 'skipRateLimit';

/**
 * Bỏ qua rate limit — CHỈ dùng cho health check: Docker / Nginx / deploy script gọi liên tục
 * từ cùng 1 IP nội bộ; bị 429 sẽ khiến container bị đánh dấu "hỏng" sai.
 */
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_KEY, true);

/** Gắn thêm hạn mức chặt hơn cho endpoint nhạy cảm, ví dụ `@RateLimit('login')`. */
export const RateLimit = (policy: Exclude<PolicyName, 'global'>) =>
  SetMetadata(RATE_LIMIT_KEY, policy);
