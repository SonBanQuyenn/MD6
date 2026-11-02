import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { extractBearerToken } from '../common/guards/jwt-auth.guard';
import { AccessTokenPayload, AuthUser } from '../common/types/auth-user';
import { RATE_LIMIT_KEY } from './rate-limit.decorator';
import {
  formatMessage,
  PolicyName,
  RateLimitPolicies,
  RateLimitPolicy,
} from './rate-limit.policies';
import { RateLimitStore } from './rate-limit.store';

export const RATE_LIMIT_POLICIES = Symbol('RATE_LIMIT_POLICIES');

/** Lỗi 429 có thêm `retryAfter` (giây) trong body để frontend hiển thị đếm ngược. */
export class TooManyRequestsException extends HttpException {
  constructor(message: string, retryAfter: number) {
    super(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message,
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Guard toàn cục, chạy TRƯỚC xác thực (xem AuthModule) để cả request sai token cũng bị đếm.
 *  1. Xác định "ai đang gọi": tài khoản (JWT hợp lệ) hoặc IP (F03.2).
 *  2. Đếm theo hạn mức chung + hạn mức riêng của endpoint (nếu có @RateLimit).
 *  3. Vượt → 429 + header Retry-After + thông điệp tiếng Việt (F03.3).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly store: RateLimitStore,
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(RATE_LIMIT_POLICIES) private readonly policies: RateLimitPolicies,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket có cơ chế xác thực riêng ở handshake — guard này chỉ dành cho HTTP.
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const routePolicy = this.reflector.getAllAndOverride<
      Exclude<PolicyName, 'global'> | undefined
    >(RATE_LIMIT_KEY, [context.getHandler(), context.getClass()]);

    const tracker = await this.identify(req);
    // Hạn mức chung trước; endpoint nhạy cảm kiểm tra thêm hạn mức riêng.
    await this.check('global', tracker, res);
    if (routePolicy) {
      // Đăng nhập luôn đếm theo IP: người chưa đăng nhập chỉ có IP để phân biệt.
      const routeTracker =
        routePolicy === 'login' ? `ip:${clientIp(req)}` : tracker;
      await this.check(routePolicy, routeTracker, res);
    }
    return true;
  }

  private async check(name: PolicyName, tracker: string, res: Response) {
    const policy: RateLimitPolicy = this.policies[name];
    const result = await this.store.hit(
      `rl:${name}:${tracker}`,
      policy.windowMs,
    );
    if (!result) return; // Redis lỗi → fail-open

    const remaining = Math.max(0, policy.limit - result.count);
    const retryAfter = Math.max(1, Math.ceil(result.resetMs / 1000));
    if (name === 'global') {
      res.setHeader('X-RateLimit-Limit', policy.limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
    }
    if (result.count > policy.limit) {
      res.setHeader('Retry-After', retryAfter);
      throw new TooManyRequestsException(
        formatMessage(policy, retryAfter),
        retryAfter,
      );
    }
  }

  /**
   * Token hợp lệ → đếm theo tài khoản (đổi IP / dùng 4G không lách được hạn mức).
   * Không có / sai token → đếm theo IP.
   */
  private async identify(req: Request & { user?: AuthUser }): Promise<string> {
    if (req.user) return `user:${req.user.id}`;
    const token = extractBearerToken(req.headers.authorization);
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
        return `user:${payload.sub}`;
      } catch {
        // token sai/hết hạn → coi như khách vãng lai
      }
    }
    return `ip:${clientIp(req)}`;
  }
}

/**
 * IP thật của khách. Sau Nginx, `req.ip` chỉ đúng khi bật `trust proxy` (TRUST_PROXY=1)
 * — nếu không mọi khách đều có IP của Nginx và dùng chung 1 hạn mức.
 */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
}
