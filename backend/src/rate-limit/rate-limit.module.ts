import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoginAttemptsService } from './login-attempts.service';
import { RATE_LIMIT_POLICIES, RateLimitGuard } from './rate-limit.guard';
import { buildPolicies } from './rate-limit.policies';
import { RateLimitStore } from './rate-limit.store';

/**
 * F03 — Bảo vệ API khỏi lạm dụng. Guard được đăng ký toàn cục ở AuthModule
 * (để đặt TRƯỚC guard xác thực); module này cung cấp các thành phần dùng chung.
 */
@Global()
@Module({
  providers: [
    RateLimitStore,
    RateLimitGuard,
    LoginAttemptsService,
    {
      provide: RATE_LIMIT_POLICIES,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        buildPolicies(config.get<number>('RATE_LIMIT_GLOBAL_PER_MINUTE', 100)),
    },
  ],
  exports: [RateLimitGuard, LoginAttemptsService],
})
export class RateLimitModule {}
